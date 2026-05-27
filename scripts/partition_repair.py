#!/usr/bin/env python3
"""Repair world_partition rows after server restarts.

When Dune Awakening game servers (survival, overmap) restart, they receive
new process correlation IDs (PCIDs/server_ids). They register in farm_state
but do NOT automatically create matching world_partition rows. The overmap
then enters a tight retry loop:

    LoadPartitionDefinition: Sql::load_world_partition(Survival_1, <PCID>, 0, 2)
    got 0 rows, expected exactly 1.

Key insight: the game binary ALWAYS queries world_partition with map='Survival_1',
even for overmap/deepdesert servers. The partition_id it queries matches the
container's -PartitionIndex=N startup argument.

Slot configuration via environment variables:
  PARTITION_SLOT_CONFIG = "farm_map:partition_id,..."
  Example: "Survival_1:1,Overmap:2,DeepDesert_1:3"

  - farm_map: the map name as it appears in farm_state (e.g. Overmap)
  - partition_id: the EXACT partition_id the game binary expects
    (must match -PartitionIndex=N in the container command)

For each slot, this script:
  1. Monitors farm_state for new server registrations
  2. Ensures the world_partition record at the configured partition_id has
     the current server_id (creating or updating as needed)
  3. Removes stale world_partition rows for dead server_ids
  4. Always stores records with map='Survival_1' (required by game binary)

Run once after each restart, or as a sidecar/cron job (watch mode recommended).
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
PASSWORD = os.environ.get("DB_PASSWORD") or os.environ.get("POSTGRES_DUNE_PASSWORD")
SCHEMA = "dune"
MAX_WAIT = int(os.environ.get("PARTITION_REPAIR_MAX_WAIT", "120"))
POLL_INTERVAL = int(os.environ.get("PARTITION_REPAIR_POLL_INTERVAL", "5"))
DEFAULT_PARTITION_DEF = '{"box": {"max_x": 1, "max_y": 1, "min_x": 0, "min_y": 0}, "type": "box2d_array"}'

# Slot configuration via environment variables (port-based, since all game servers
# register with map='Survival_1' in farm_state regardless of their logical role).
# PARTITION_SLOT_CONFIG = "game_port:partition_id,..."
# Example: "7777:1,7778:2" means port 7777→partition_id=1, port 7778→partition_id=2
# Must match -PartitionIndex=N in each game server container command.
def _parse_slot_config() -> dict:
    raw = os.environ.get("PARTITION_SLOT_CONFIG", "7777:1,7778:2")
    slots = {}
    for part in raw.split(","):
        part = part.strip()
        if ":" not in part:
            continue
        key, _, pid_str = part.partition(":")
        try:
            slots[int(key.strip())] = int(pid_str.strip())
        except ValueError:
            pass
    return slots

SLOT_CONFIG: dict = _parse_slot_config()  # game_port → target_partition_id


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

    Important: all game servers (survival, overmap, etc.) register with
    map='Survival_1' in farm_state. The only distinguishing factor is game_port.
    The game binary always queries world_partition with map='Survival_1' and the
    exact partition_id matching its -PartitionIndex=N arg.

    Strategy per slot (identified by game_port):
      - Find the UNIQUE alive server for this port. If multiple are alive (stale
        entries from crash-loops), pick the one NOT currently at the target
        partition_id, or the last one if all are stale.
      - Ensure the world_partition record at target_partition_id has the current
        server_id (inserting or updating as needed).
      - Null out dead server_ids in world_partition for slot anchor records.
      - Delete non-slot stale partition records.
    """
    with get_connection() as conn:
        conn.autocommit = False
        with conn.cursor() as cur:
            # Get all alive servers from farm_state
            cur.execute(
                "SELECT server_id, map, game_port FROM farm_state WHERE alive = true"
            )
            rows = cur.fetchall()
            alive_ids = {r[0] for r in rows}
            log.info("Alive server count: %d", len(rows))

            # Group alive server_ids by game_port
            port_to_sids: dict = {}
            for server_id, _, game_port in rows:
                port_to_sids.setdefault(game_port, []).append(server_id)

            # Get current world_partition state
            cur.execute("SELECT partition_id, server_id, map FROM world_partition")
            partitions = cur.fetchall()
            log.info(
                "Existing partitions: %s",
                [(p[0], (p[1] or "")[:8] + "...", p[2]) for p in partitions],
            )

            # Index: partition_id → (server_id, map)
            pid_to_row = {p[0]: (p[1], p[2]) for p in partitions}

            created = 0
            updated = 0
            deleted = 0

            # --- Process each configured port slot ---
            target_pids = set(SLOT_CONFIG.values())

            for game_port, target_pid in SLOT_CONFIG.items():
                sids = port_to_sids.get(game_port, [])
                if not sids:
                    log.info("No alive servers on port %d (slot partition_id=%d)", game_port, target_pid)
                    continue

                current_row = pid_to_row.get(target_pid)
                current_sid_at_slot = current_row[0] if current_row else None

                # Pick the "best" server_id for this slot:
                # Prefer the one already at the slot (no update needed),
                # otherwise take the last in the list (most recently added to
                # farm_state — smaller IDs are older registrations).
                if current_sid_at_slot and current_sid_at_slot in sids:
                    chosen_sid = current_sid_at_slot
                else:
                    # All entries may be stale - pick the last one (arbitrary
                    # but deterministic; partition-repair will correct on next cycle)
                    chosen_sid = sids[-1]

                log.info(
                    "Port %d → partition_id=%d, chosen server_id=%s (%d alive on this port)",
                    game_port, target_pid, chosen_sid[:8], len(sids),
                )

                if current_row is None:
                    _insert_partition_at(cur, target_pid, chosen_sid, log)
                    pid_to_row[target_pid] = (chosen_sid, "Survival_1")
                    created += 1

                elif current_row[0] == chosen_sid:
                    # server_id is correct; ensure map is right
                    if current_row[1] != "Survival_1":
                        cur.execute(
                            "UPDATE world_partition SET map = 'Survival_1' WHERE partition_id = %s",
                            (target_pid,),
                        )
                        log.info(
                            "Fixed map at partition_id=%d server_id=%s: %s → Survival_1",
                            target_pid, chosen_sid[:8], current_row[1],
                        )
                        pid_to_row[target_pid] = (chosen_sid, "Survival_1")
                        updated += 1
                    else:
                        log.info(
                            "Partition OK: partition_id=%d server_id=%s map=Survival_1",
                            target_pid, chosen_sid[:8],
                        )

                else:
                    old_sid = current_row[0] or "<none>"
                    cur.execute(
                        "UPDATE world_partition SET server_id = %s, map = 'Survival_1' "
                        "WHERE partition_id = %s",
                        (chosen_sid, target_pid),
                    )
                    log.info(
                        "Updated partition_id=%d: server_id %s → %s (map=Survival_1)",
                        target_pid, old_sid[:8], chosen_sid[:8],
                    )
                    pid_to_row[target_pid] = (chosen_sid, "Survival_1")
                    updated += 1

            # --- Clean up stale non-slot partitions and dead server_ids ---
            cur.execute("SELECT partition_id, server_id, map FROM world_partition")
            after = cur.fetchall()
            for pid, sid, mname in after:
                if pid in target_pids:
                    # Slot anchor: null dead server_ids but keep the record
                    if sid and sid not in alive_ids:
                        cur.execute(
                            "UPDATE world_partition SET server_id = NULL WHERE partition_id = %s",
                            (pid,),
                        )
                        log.info(
                            "Nulled dead server_id at slot partition_id=%d (was %s)",
                            pid, sid[:8],
                        )
                        updated += 1
                elif sid and sid not in alive_ids:
                    cur.execute(
                        "DELETE FROM world_partition WHERE partition_id = %s",
                        (pid,),
                    )
                    log.info(
                        "Deleted stale non-slot partition partition_id=%d server_id=%s map=%s",
                        pid, sid[:8], mname,
                    )
                    deleted += 1

            conn.commit()

            log.info(
                "Partition repair complete: %d created, %d updated, %d deleted",
                created, updated, deleted,
            )

            cur.execute(
                "SELECT partition_id, server_id, map FROM world_partition ORDER BY partition_id"
            )
            for row in cur.fetchall():
                log.info(
                    "  partition_id=%d server=%s map=%s",
                    row[0], (row[1] or "<none>")[:16], row[2],
                )

    return created + updated


def _insert_partition_at(cur, partition_id: int, server_id: str, log) -> None:
    """Insert a world_partition record with an EXPLICIT partition_id."""
    try:
        cur.execute("SAVEPOINT sp_insert")
        cur.execute(
            "INSERT INTO world_partition "
            "(partition_id, server_id, map, partition_definition, dimension_index) "
            "VALUES (%s, %s, 'Survival_1', %s::jsonb, 0)",
            (partition_id, server_id, DEFAULT_PARTITION_DEF),
        )
        cur.execute("RELEASE SAVEPOINT sp_insert")
        log.info(
            "Inserted partition_id=%d server_id=%s map=Survival_1",
            partition_id, server_id[:8],
        )
    except Exception as exc:
        cur.execute("ROLLBACK TO SAVEPOINT sp_insert")
        log.warning(
            "Failed to insert partition_id=%d server_id=%s: %s",
            partition_id, server_id[:8], exc,
        )


def _insert_partition_fallback(cur, server_id: str, farm_map: str, log) -> None:
    """Insert a world_partition row without an explicit partition_id (auto-increment)."""
    try:
        cur.execute("SAVEPOINT sp_fallback")
        cur.execute(
            "INSERT INTO world_partition (server_id, map, partition_definition, dimension_index) "
            "VALUES (%s, %s, %s::jsonb, 0)",
            (server_id, farm_map, DEFAULT_PARTITION_DEF),
        )
        cur.execute("RELEASE SAVEPOINT sp_fallback")
        log.info(
            "Inserted fallback partition for server_id=%s map=%s",
            server_id[:8], farm_map,
        )
    except Exception as exc:
        cur.execute("ROLLBACK TO SAVEPOINT sp_fallback")
        log.warning(
            "Fallback insert failed for server_id=%s map=%s: %s",
            server_id[:8], farm_map, exc,
        )


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="[%(levelname)s] %(asctime)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    log = logging.getLogger("partition-repair")

    if not PASSWORD:
        print("[ERROR] DB_PASSWORD / POSTGRES_DUNE_PASSWORD is not set", file=sys.stderr)
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
