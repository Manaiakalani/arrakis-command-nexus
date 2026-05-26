#!/usr/bin/env python3
"""Repair world_partition rows after server restarts.

When Dune Awakening game servers (survival, overmap) restart, they receive
new process correlation IDs (PCIDs/server_ids). They register in farm_state
but do NOT automatically create matching world_partition rows. The overmap
then enters a tight retry loop:

    LoadPartitionDefinition: Sql::load_world_partition(Survival_1, <PCID>, 0, 2)
    got 0 rows, expected exactly 1.

This script:
  1. Waits for servers to appear in farm_state
  2. Ensures every server_id in farm_state has a world_partition row
  3. Removes stale world_partition rows for server_ids no longer in farm_state

Run once after each restart, or as a sidecar/cron job.
"""
import logging
import os
import sys
import time

import psycopg2

HOST = os.environ.get("DB_HOST", "postgres")
PORT = int(os.environ.get("DB_PORT", "5432"))
DATABASE = os.environ.get("DB_NAME", "dune_sb_1_4_0_0")
USER = os.environ.get("DB_USER", "dune")
PASSWORD = os.environ.get("POSTGRES_DUNE_PASSWORD")
SCHEMA = "dune"
MAX_WAIT = int(os.environ.get("PARTITION_REPAIR_MAX_WAIT", "120"))
POLL_INTERVAL = int(os.environ.get("PARTITION_REPAIR_POLL_INTERVAL", "5"))
DEFAULT_PARTITION_DEF = '{"box": {"max_x": 1, "max_y": 1, "min_x": 0, "min_y": 0}, "type": "box2d_array"}'


def get_connection():
    return psycopg2.connect(
        host=HOST, port=PORT, database=DATABASE, user=USER, password=PASSWORD,
        options=f"-c search_path={SCHEMA},public",
    )


def wait_for_servers(log, min_servers=2):
    """Block until at least min_servers appear in farm_state."""
    deadline = time.time() + MAX_WAIT
    while time.time() < deadline:
        try:
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) FROM farm_state WHERE alive = true")
                    count = cur.fetchone()[0]
                    if count >= min_servers:
                        log.info("Found %d alive servers in farm_state", count)
                        return True
                    log.info("Waiting for servers... %d/%d alive", count, min_servers)
        except psycopg2.OperationalError as e:
            log.warning("DB not ready: %s", e)
        time.sleep(POLL_INTERVAL)
    log.warning("Timed out waiting for %d servers after %ds", min_servers, MAX_WAIT)
    return False


def fix_gateway_function(log):
    """Patch get_active_servers_for_gateway() to use INNER JOIN on world_partition.

    The stock function uses a LEFT JOIN, which returns NULL partition_id for
    servers (like the overmap) that have no world_partition row.  The gateway
    then logs hundreds of 'Got invalid partition index (None)' warnings.
    Switching to INNER JOIN silences them without affecting gameplay.
    """
    with get_connection() as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                "SELECT prosrc FROM pg_proc WHERE proname = 'get_active_servers_for_gateway'"
            )
            row = cur.fetchone()
            if row and "left join world_partition" in (row[0] or "").lower():
                cur.execute("DROP FUNCTION IF EXISTS dune.get_active_servers_for_gateway()")
                cur.execute("""
                    CREATE FUNCTION dune.get_active_servers_for_gateway()
                    RETURNS TABLE(server_id text, map text, partition_id bigint,
                                  dimension_index integer, game_addr inet,
                                  game_port integer, revision integer)
                    LANGUAGE plpgsql AS $$
                    DECLARE
                    BEGIN
                        RETURN QUERY
                            SELECT fs.server_id, fs.map, wp.partition_id,
                                   coalesce(wp.dimension_index, 0),
                                   fs.game_addr, fs.game_port, fs.revision
                            FROM active_server_ids AS asi
                            JOIN world_partition AS wp ON asi.server_id = wp.server_id
                            JOIN farm_state AS fs ON fs.server_id = asi.server_id;
                    END
                    $$;
                """)
                log.info("Patched get_active_servers_for_gateway: LEFT JOIN -> INNER JOIN")
            else:
                log.info("Gateway function already patched or not found, skipping")


def repair_partitions(log):
    """Ensure every alive server in farm_state has a world_partition row.

    Strategy: delete stale partitions first (freeing labels for the DB trigger),
    then claim or create partitions for alive servers.
    """
    with get_connection() as conn:
        conn.autocommit = False
        with conn.cursor() as cur:
            # Get all alive servers from farm_state
            cur.execute(
                "SELECT server_id, map, igw_addr, igw_port FROM farm_state WHERE alive = true"
            )
            servers = cur.fetchall()
            alive_ids = {s[0] for s in servers}
            log.info("Alive servers: %s", [(s[0][:8] + "...", s[1]) for s in servers])

            # Get existing world_partition entries
            cur.execute("SELECT partition_id, server_id, map, dimension_index FROM world_partition")
            existing = cur.fetchall()
            existing_server_ids = {row[1] for row in existing if row[1]}
            log.info(
                "Existing partitions: %s",
                [(p[0], (p[1] or "")[:8] + "...", p[2]) for p in existing],
            )

            # --- Phase 1: Delete stale partitions FIRST ---
            # Stale = server_id set but not in alive farm_state.
            # We DELETE (not NULL) so the label unique constraint is freed,
            # preventing crash loops when new servers try to INSERT.
            stale = [
                row for row in existing
                if row[1] and row[1] not in alive_ids
            ]
            deleted = 0
            for partition_id, server_id, map_name, _ in stale:
                cur.execute(
                    "DELETE FROM world_partition WHERE partition_id = %s",
                    (partition_id,),
                )
                log.info(
                    "Deleted stale partition partition_id=%d server_id=%s map=%s to free label",
                    partition_id, server_id[:8], map_name,
                )
                deleted += 1

            # Also delete orphan partitions (NULL/empty server_id) that block
            # label assignment. If alive servers already have their own partitions,
            # orphans for the same map are stale leftovers whose labels block new inserts.
            cur.execute("SELECT partition_id, server_id, map, dimension_index FROM world_partition")
            post_delete = cur.fetchall()
            alive_maps = {s[1] for s in servers}
            alive_with_partition = set()
            orphans_to_delete = []
            for row in post_delete:
                pid, sid, mname, _ = row
                if sid and sid in alive_ids:
                    alive_with_partition.add(mname)

            for row in post_delete:
                pid, sid, mname, _ = row
                if (not sid or sid == '') and mname in alive_with_partition:
                    orphans_to_delete.append(row)

            for partition_id, server_id, map_name, _ in orphans_to_delete:
                cur.execute(
                    "DELETE FROM world_partition WHERE partition_id = %s",
                    (partition_id,),
                )
                log.info(
                    "Deleted orphan partition partition_id=%d server_id=<none> map=%s because an alive server already has a partition",
                    partition_id, map_name,
                )
                deleted += 1

            conn.commit()

            # --- Phase 2: Refresh existing state after deletions ---
            cur.execute("SELECT partition_id, server_id, map, dimension_index FROM world_partition")
            existing = cur.fetchall()
            existing_server_ids = {row[1] for row in existing if row[1]}
            # Build map→partition lookup: for each map+dim, which partition exists
            map_dim_partitions = {}
            for pid, sid, mname, dim in existing:
                key = (mname, dim)
                if key not in map_dim_partitions:
                    map_dim_partitions[key] = []
                map_dim_partitions[key].append((pid, sid))

            # --- Phase 3: Claim or create partitions for alive servers ---
            created = 0
            updated = 0

            for server_id, map_name, igw_addr, igw_port in servers:
                if server_id in existing_server_ids:
                    log.info(
                        "Partition already exists for server_id=%s map=%s",
                        server_id[:8], map_name,
                    )
                    continue

                # The label trigger is deterministic per (map, dimension_index).
                # Only one partition per map+dim can exist due to the unique label.
                # Strategy: claim an existing partition instead of inserting.
                key = (map_name, 0)
                existing_for_map = map_dim_partitions.get(key, [])

                # Find a claimable partition (NULL server_id, or stale server_id)
                claimed = False
                for i, (pid, sid) in enumerate(existing_for_map):
                    if not sid or sid == '' or sid not in alive_ids:
                        cur.execute(
                            "UPDATE world_partition SET server_id = %s WHERE partition_id = %s",
                            (server_id, pid),
                        )
                        log.info(
                            "Claimed partition partition_id=%d server_id=%s map=%s previous_server_id=%s",
                            pid, server_id[:8], map_name, (sid or "<none>")[:8],
                        )
                        # Update local state so subsequent iterations see this as taken
                        existing_for_map[i] = (pid, server_id)
                        existing_server_ids.add(server_id)
                        updated += 1
                        claimed = True
                        break

                if not claimed and not existing_for_map:
                    # No partition exists at all for this map -- safe to insert
                    try:
                        cur.execute("SAVEPOINT sp_insert")
                        cur.execute(
                            "INSERT INTO world_partition (server_id, map, partition_definition, dimension_index) "
                            "VALUES (%s, %s, %s::jsonb, 0)",
                            (server_id, map_name, DEFAULT_PARTITION_DEF),
                        )
                        cur.execute("RELEASE SAVEPOINT sp_insert")
                        log.info(
                            "Created partition for server_id=%s map=%s partition_id=<new>",
                            server_id[:8], map_name,
                        )
                        created += 1
                    except Exception as exc:
                        cur.execute("ROLLBACK TO SAVEPOINT sp_insert")
                        log.warning(
                            "Failed to create partition for server_id=%s map=%s partition_id=<new>: %s",
                            server_id[:8], map_name, exc,
                        )
                elif not claimed:
                    # Partition exists but owned by another alive server.
                    # Do NOT reassign -- the owning server is actively using it.
                    # Ghost server_ids from Docker restarts will eventually expire
                    # from farm_state. The pre-start script handles legitimate
                    # restarts by NULLing the partition's server_id first.
                    log.info(
                        "Partition for map=%s is owned by an alive server, skipping ghost server_id=%s",
                        map_name, server_id[:8],
                    )

            log.info(
                "Partition repair complete: %d created, %d claimed, %d stale deleted",
                created, updated, deleted,
            )
            conn.commit()

            # Show final state
            cur.execute(
                "SELECT partition_id, server_id, map, dimension_index FROM world_partition ORDER BY partition_id"
            )
            final = cur.fetchall()
            for row in final:
                log.info(
                    "  partition_id=%d server=%s map=%s dim=%d",
                    row[0], (row[1] or "<none>")[:16], row[2], row[3],
                )

    return created + updated


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="[%(levelname)s] %(asctime)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    log = logging.getLogger("partition-repair")

    if not PASSWORD:
        print("[ERROR] POSTGRES_DUNE_PASSWORD is not set", file=sys.stderr)
        return 1

    watch_mode = os.environ.get("PARTITION_REPAIR_WATCH", "").lower() in ("1", "true", "yes")
    watch_interval = int(os.environ.get("PARTITION_REPAIR_WATCH_INTERVAL", "30"))

    log.info("Starting partition repair target=%s:%d/%s", HOST, PORT, DATABASE)
    wait_for_servers(log, min_servers=1)
    fix_gateway_function(log)
    changes = repair_partitions(log)

    if changes == 0:
        log.info("No changes needed")

    if watch_mode:
        consecutive_failures = 0
        log.info("Watch mode enabled, checking every %ds", watch_interval)
        while True:
            time.sleep(watch_interval)
            try:
                repair_partitions(log)
                consecutive_failures = 0
            except Exception:
                consecutive_failures += 1
                log.exception(
                    "Watch cycle failed (consecutive_failures=%d/10)",
                    consecutive_failures,
                )
                if consecutive_failures >= 10:
                    log.error(
                        "Watch mode exiting after %d consecutive failures",
                        consecutive_failures,
                    )
                    return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
