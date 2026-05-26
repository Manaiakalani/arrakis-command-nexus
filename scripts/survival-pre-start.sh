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
date +%s > "$CRASH_MARKER"

# Clear the partition's server_id so our poll below can assign the new
# server_id from this startup.
echo "[pre-start] Clearing stale server_id for map=$MAP_NAME..."
if [[ "$MAP_NAME" =~ ^[A-Za-z0-9_-]+$ ]]; then
  psql -h postgres -p 5432 -U dune -d "$DB_NAME" \
    -c "UPDATE dune.world_partition SET server_id = NULL WHERE map = '$MAP_NAME';" 2>&1 || true
fi

# Purge ghost entries from farm_state for this map. Each crash-restart
# registers a new server_id but never cleans up old ones.
echo "[pre-start] Purging stale farm_state entries for map=$MAP_NAME..."
psql -h postgres -p 5432 -U dune -d "$DB_NAME" \
  -c "DELETE FROM dune.farm_state WHERE map = '$MAP_NAME';" 2>&1 || true

# Start the game server in the background, then poll farm_state for its
# new server_id and immediately assign it to the partition. This closes
# the timing gap between the game registering (~2s) and querying the
# partition (~5s), which causes "Local partition is not found" crashes
# because partition-repair only runs every 30s.
echo "[pre-start] Starting game server for map=$MAP_NAME..."
/home/dune/run.sh "$@" &
GAME_PID=$!

ASSIGN_TIMEOUT=15
ASSIGN_POLL=1
elapsed_assign=0
while [ "$elapsed_assign" -lt "$ASSIGN_TIMEOUT" ]; do
  sleep "$ASSIGN_POLL"
  elapsed_assign=$(( elapsed_assign + ASSIGN_POLL ))

  NEW_ID=$(psql -h postgres -p 5432 -U dune -d "$DB_NAME" -t -A -c \
    "SELECT fs.server_id FROM dune.farm_state fs
     WHERE fs.map = '$MAP_NAME' AND fs.alive = true
       AND NOT EXISTS (SELECT 1 FROM dune.world_partition wp WHERE wp.server_id = fs.server_id)
     ORDER BY fs.server_id LIMIT 1;" 2>/dev/null)

  if [ -n "$NEW_ID" ]; then
    echo "[pre-start] Assigning partition to server_id=$NEW_ID (took ${elapsed_assign}s)"
    psql -h postgres -p 5432 -U dune -d "$DB_NAME" -c \
      "UPDATE dune.world_partition SET server_id = '$NEW_ID' WHERE map = '$MAP_NAME' AND (server_id IS NULL OR server_id = '');" 2>&1 || true
    break
  fi
done

if [ "$elapsed_assign" -ge "$ASSIGN_TIMEOUT" ]; then
  echo "[pre-start] WARNING: Could not assign partition within ${ASSIGN_TIMEOUT}s, relying on partition-repair"
fi

# Forward signals to the game process
trap "kill $GAME_PID 2>/dev/null" SIGTERM SIGINT

# Wait for the game process to exit
wait $GAME_PID
exit $?
