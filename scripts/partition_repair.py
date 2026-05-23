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
PASSWORD = os.environ.get("POSTGRES_DUNE_PASSWORD", os.environ.get("DB_PASSWORD", "change-me-dune-db"))
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


def repair_partitions(log):
    """Ensure every alive server in farm_state has a world_partition row."""
    with get_connection() as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            # Get all alive servers from farm_state
            cur.execute(
                "SELECT server_id, map, igw_addr, igw_port FROM farm_state WHERE alive = true"
            )
            servers = cur.fetchall()
            log.info("Alive servers: %s", [(s[0][:8] + "...", s[1]) for s in servers])

            # Get existing world_partition entries
            cur.execute("SELECT partition_id, server_id, map, dimension_index FROM world_partition")
            existing = cur.fetchall()
            existing_server_ids = {row[1] for row in existing if row[1]}
            log.info(
                "Existing partitions: %s",
                [(p[0], (p[1] or "")[:8] + "...", p[2]) for p in existing],
            )

            created = 0
            updated = 0

            for server_id, map_name, igw_addr, igw_port in servers:
                if server_id in existing_server_ids:
                    log.info(
                        "Partition already exists for server %s... (map=%s)",
                        server_id[:8], map_name,
                    )
                    continue

                # Check if there's a partition with empty server_id for this map
                cur.execute(
                    "SELECT partition_id FROM world_partition "
                    "WHERE (server_id IS NULL OR server_id = '') AND map = %s "
                    "LIMIT 1",
                    (map_name,),
                )
                orphan = cur.fetchone()

                if orphan:
                    # Claim the orphan partition
                    cur.execute(
                        "UPDATE world_partition SET server_id = %s WHERE partition_id = %s",
                        (server_id, orphan[0]),
                    )
                    log.info(
                        "Claimed orphan partition %d for server %s... (map=%s)",
                        orphan[0], server_id[:8], map_name,
                    )
                    updated += 1
                else:
                    # Create new partition entry
                    cur.execute(
                        "INSERT INTO world_partition (server_id, map, partition_definition, dimension_index) "
                        "VALUES (%s, %s, %s::jsonb, 0)",
                        (server_id, map_name, DEFAULT_PARTITION_DEF),
                    )
                    log.info(
                        "Created partition for server %s... (map=%s)",
                        server_id[:8], map_name,
                    )
                    created += 1

            # Clean up stale partitions (server_id no longer in farm_state)
            alive_ids = {s[0] for s in servers}
            stale = [
                row for row in existing
                if row[1] and row[1] not in alive_ids
            ]
            cleared = 0
            for partition_id, server_id, map_name, _ in stale:
                cur.execute(
                    "UPDATE world_partition SET server_id = NULL WHERE partition_id = %s",
                    (partition_id,),
                )
                log.info(
                    "Cleared stale server_id %s... from partition %d (map=%s)",
                    server_id[:8], partition_id, map_name,
                )
                cleared += 1

            log.info(
                "Partition repair complete: %d created, %d claimed, %d stale cleared",
                created, updated, cleared,
            )

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

    watch_mode = os.environ.get("PARTITION_REPAIR_WATCH", "").lower() in ("1", "true", "yes")
    watch_interval = int(os.environ.get("PARTITION_REPAIR_WATCH_INTERVAL", "30"))

    log.info("Starting partition repair (target: %s:%d/%s)", HOST, PORT, DATABASE)
    wait_for_servers(log, min_servers=1)
    changes = repair_partitions(log)

    if changes == 0:
        log.info("No changes needed")

    if watch_mode:
        log.info("Watch mode enabled, checking every %ds", watch_interval)
        while True:
            time.sleep(watch_interval)
            try:
                repair_partitions(log)
            except Exception as exc:
                log.warning("Watch cycle failed: %s", exc)

    return 0


if __name__ == "__main__":
    sys.exit(main())
