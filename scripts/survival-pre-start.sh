#!/bin/bash
MAP_NAME="${PARTITION_MAP_NAME:-Survival_1}"
DB_NAME="${POSTGRES_DB_NAME:-dune_sb_1_4_0_0}"
export PGPASSWORD="${POSTGRES_DUNE_PASSWORD:-change-me-dune-db}"

# Crash-cooldown: if the server crashed recently, wait before restarting
# to avoid CPU/memory thrashing from rapid restart loops.
CRASH_MARKER="/tmp/.server_crash_marker"
COOLDOWN_SECONDS="${RESTART_COOLDOWN_SECONDS:-60}"
if [ -f "$CRASH_MARKER" ]; then
  last_crash=$(cat "$CRASH_MARKER" 2>/dev/null || echo 0)
  now=$(date +%s)
  elapsed=$(( now - last_crash ))
  if [ "$elapsed" -lt "$COOLDOWN_SECONDS" ]; then
    wait_time=$(( COOLDOWN_SECONDS - elapsed ))
    echo "[pre-start] Crash-cooldown: waiting ${wait_time}s before restart (last crash ${elapsed}s ago)..."
    sleep "$wait_time"
  fi
fi
# Record current time as potential crash marker (removed on clean shutdown)
date +%s > "$CRASH_MARKER"

# NOTE: We intentionally do NOT clear server_id from dune.world_partition.
# The game binary generates a new server_id each startup and registers it
# via the director. Clearing it causes "Partition's ServerId is null or
# empty!" errors in the director and "Local partition is not found" crashes
# in S2sController.cpp.

echo "[pre-start] Starting game server for map=$MAP_NAME..."
exec /home/dune/run.sh "$@"