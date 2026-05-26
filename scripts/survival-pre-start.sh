#!/bin/bash
MAP_NAME="${PARTITION_MAP_NAME:-Survival_1}"
DB_NAME="${POSTGRES_DB_NAME:-dune_sb_1_4_0_0}"
export PGPASSWORD="${POSTGRES_DUNE_PASSWORD:-change-me-dune-db}"

# Crash-cooldown: if the server crashed recently, wait before restarting
# to avoid CPU/memory thrashing from rapid restart loops.
CRASH_MARKER="/tmp/.server_crash_marker"
COOLDOWN_SECONDS="${RESTART_COOLDOWN_SECONDS:-30}"
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

echo "[pre-start] Clearing stale server_id for map=$MAP_NAME..."
if [[ "$MAP_NAME" =~ ^[A-Za-z0-9_-]+$ ]]; then
  psql -h postgres -p 5432 -U dune -d "$DB_NAME" \
    -c "UPDATE dune.world_partition SET server_id = NULL WHERE map = '$MAP_NAME';" 2>&1 || true
else
  echo "[pre-start] Skipping stale server cleanup because PARTITION_MAP_NAME is invalid." >&2
fi

echo "[pre-start] Done, starting game server..."
exec /home/dune/run.sh "$@"