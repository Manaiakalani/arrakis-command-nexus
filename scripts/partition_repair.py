#!/usr/bin/env python3
"""Repair world_partition rows after game server restarts.

Each time a Dune Awakening game server (survival_1, overmap) restarts it
receives a new server_id (PCID).  It registers in farm_state but does NOT
automatically own a world_partition row.  The game then calls the Postgres
function load_world_partition() to find its partition; if none is found it
crashes immediately.

Patched load_world_partition() behaviour (applied once by this script):
  Primary lookup : WHERE server_id = <sid> AND dimension_index = <dim>
                   (map-agnostic -- works for both Survival_1 and Overmap)
  Fallback lookup: WHERE server_id IS NULL/dead AND map = in_map_name
                   (claims an unassigned slot)

Port-to-map mapping (PARTITION_PORT_MAP env var, JSON):
  {"7777": "Survival_1", "7778": "Overmap"}
  This tells partition_repair which world_partition map label to use when
  creating/updating a record for the server that listens on each game port.

For each alive server (game_port → server_id):
  1. Look for an existing world_partition record for that server_id.
  2. If found and healthy: no action needed.
  3. If not found: find an unassigned partition for the expected map type
     (server_id IS NULL or dead) and UPDATE server_id onto it.
  4. If no unassigned partition exists: INSERT a new one with the correct map.

Dead server_id cleanup:
  - world_partition rows whose server_id is not in any alive farm_state entry
    AND is not NULL have their server_id set to NULL (freeing them for reuse).
  - Only the Survival_1 and Overmap rows are managed; others are left alone.
"""
import logging
import os
import sys
import time

import psycopg2

import json

HOST = os.environ.get("DB_HOST", "postgres")
PORT = int(os.environ.get("DB_PORT", "5432"))
DATABASE = os.environ.get("DB_NAME", "dune_sb_1_4_0_0")
USER = os.environ.get("DB_USER", "dune")
PASSWORD = os.environ.get("DB_PASSWORD") or os.environ.get("POSTGRES_DUNE_PASSWORD")
SCHEMA = "dune"
MAX_WAIT = int(os.environ.get("PARTITION_REPAIR_MAX_WAIT", "120"))
POLL_INTERVAL = int(os.environ.get("PARTITION_REPAIR_POLL_INTERVAL", "5"))
DEFAULT_PARTITION_DEF = '{"box": {"max_x": 1, "max_y": 1, "min_x": 0, "min_y": 0}, "type": "box2d_array"}'

# Port-to-partition-map mapping.
# PARTITION_PORT_MAP (JSON string): maps game_port → world_partition map name.
# Example: '{"7777":"Survival_1","7778":"Overmap"}'
# Defaults cover the standard basic deployment (survival + overmap).
def _parse_port_map() -> dict:
    raw = os.environ.get("PARTITION_PORT_MAP", '{"7777":"Survival_1","7778":"Overmap"}')
    try:
        return {int(k): v for k, v in json.loads(raw).items()}
    except Exception:
        return {7777: "Survival_1", 7778: "Overmap"}


PORT_MAP: dict = _parse_port_map()  # game_port → world_partition map name


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
    """Ensure every alive server has a valid world_partition row.

    All game servers (survival_1, overmap, etc.) register in farm_state with
    map='Survival_1'.  The only reliable distinguishing factor between them is
    game_port.  PORT_MAP maps each game_port to the correct world_partition map
    label (e.g. 7777 → 'Survival_1', 7778 → 'Overmap').

    The patched load_world_partition() SQL function now does a map-agnostic
    lookup: WHERE server_id = <sid> AND dimension_index = <dim>.  So we only
    need to ensure each alive server_id has exactly one world_partition row with
    dimension_index=0 — the map label no longer needs to be 'Survival_1'.

    Algorithm:
      1. For each configured game_port, pick the CURRENT alive server_id.
      2. Check whether that server_id already has a world_partition row.
      3. If yes and healthy → nothing to do.
      4. If no → find an existing partition for that map label with a dead or
         NULL server_id, and UPDATE server_id onto it.
         If no such partition exists, INSERT a new one.
      5. After processing all ports, null out dead server_ids in any remaining
         rows whose server_id is no longer alive (keeps slots available for
         future use without deleting records).
    """
    with get_connection() as conn:
        conn.autocommit = False
        with conn.cursor() as cur:
            # Collect alive server_ids from farm_state (includes stale crash entries)
            cur.execute("SELECT server_id, game_port FROM farm_state WHERE alive = true")
            rows = cur.fetchall()
            alive_ids = {r[0] for r in rows}

            # Build: game_port → list of alive server_ids (last = most recent)
            port_to_sids: dict = {}
            for server_id, game_port in rows:
                port_to_sids.setdefault(game_port, []).append(server_id)

            # Collect active server_ids (those with live DB connections)
            cur.execute("SELECT server_id FROM active_server_ids")
            active_ids = {r[0] for r in cur.fetchall()}
            log.info(
                "farm_state alive=%d  active_db_connections=%d  configured_ports=%s",
                len(alive_ids), len(active_ids), list(PORT_MAP.keys()),
            )

            # Snapshot current world_partition state
            cur.execute(
                "SELECT partition_id, server_id, map FROM world_partition ORDER BY partition_id"
            )
            partitions = cur.fetchall()
            # sid → partition_id (for alive-server lookup)
            sid_to_pid = {p[1]: p[0] for p in partitions if p[1]}
            # map → list of (partition_id, server_id) — for finding unassigned slots
            map_to_parts: dict = {}
            for pid, sid, mname in partitions:
                map_to_parts.setdefault(mname, []).append((pid, sid))

            created = updated = 0

            for game_port, expected_map in PORT_MAP.items():
                sids = port_to_sids.get(game_port, [])
                if not sids:
                    log.debug("No alive server on port %d", game_port)
                    continue

                # Prefer an active (DB-connected) server_id; otherwise pick last
                # (most recently added to farm_state in the crash-loop).
                chosen = next((s for s in reversed(sids) if s in active_ids), sids[-1])

                if chosen in sid_to_pid:
                    log.info(
                        "Port %d OK: server_id=%.8s already has partition_id=%d (map=%s)",
                        game_port, chosen, sid_to_pid[chosen], expected_map,
                    )
                    continue

                # This server_id has no partition → assign one.
                assigned = False
                for pid, sid in map_to_parts.get(expected_map, []):
                    # Prefer a slot whose server_id is dead or NULL
                    if sid is None or sid not in active_ids:
                        old = sid or "<none>"
                        cur.execute(
                            "UPDATE world_partition SET server_id = %s "
                            "WHERE partition_id = %s",
                            (chosen, pid),
                        )
                        log.info(
                            "Port %d: reassigned partition_id=%d map=%s "
                            "server_id %.8s → %.8s",
                            game_port, pid, expected_map, old, chosen,
                        )
                        sid_to_pid[chosen] = pid
                        updated += 1
                        assigned = True
                        break

                if not assigned:
                    # No existing slot available; insert a new one.
                    try:
                        cur.execute("SAVEPOINT sp_ins")
                        cur.execute(
                            "INSERT INTO world_partition "
                            "(server_id, map, partition_definition, dimension_index) "
                            "VALUES (%s, %s, %s::jsonb, 0)",
                            (chosen, expected_map, DEFAULT_PARTITION_DEF),
                        )
                        cur.execute("RELEASE SAVEPOINT sp_ins")
                        log.info(
                            "Port %d: inserted new partition map=%s server_id=%.8s",
                            game_port, expected_map, chosen,
                        )
                        created += 1
                    except Exception as exc:
                        cur.execute("ROLLBACK TO SAVEPOINT sp_ins")
                        log.warning(
                            "Port %d: failed to insert partition map=%s: %s",
                            game_port, expected_map, exc,
                        )

            # Null out dead server_ids so those slots are reclaimable next cycle.
            cur.execute("SELECT partition_id, server_id FROM world_partition WHERE server_id IS NOT NULL")
            for pid, sid in cur.fetchall():
                if sid not in active_ids and sid not in alive_ids:
                    cur.execute(
                        "UPDATE world_partition SET server_id = NULL WHERE partition_id = %s",
                        (pid,),
                    )
                    log.info("Nulled dead server_id=%.8s at partition_id=%d", sid, pid)
                    updated += 1

            conn.commit()

            cur.execute(
                "SELECT partition_id, server_id, map FROM world_partition ORDER BY partition_id"
            )
            for row in cur.fetchall():
                log.info(
                    "  partition_id=%d  server=%-20s  map=%s",
                    row[0], (row[1] or "<unassigned>")[:20], row[2],
                )

            log.info(
                "Partition repair done: %d created, %d updated", created, updated
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
        print("[ERROR] DB_PASSWORD / POSTGRES_DUNE_PASSWORD is not set", file=sys.stderr)
        return 1

    watch_mode = os.environ.get("PARTITION_REPAIR_WATCH", "").lower() in ("1", "true", "yes")
    watch_interval = int(os.environ.get("PARTITION_REPAIR_WATCH_INTERVAL", "30"))

    log.info("Starting partition repair target=%s:%d/%s port_map=%s", HOST, PORT, DATABASE, PORT_MAP)
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
