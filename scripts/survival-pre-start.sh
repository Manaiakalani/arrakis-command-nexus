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

# Clear stale data before starting.
echo "[pre-start] Clearing stale partition/farm data for map=$MAP_NAME..."
if [[ "$MAP_NAME" =~ ^[A-Za-z0-9_-]+$ ]]; then
  psql -h postgres -p 5432 -U dune -d "$DB_NAME" -c \
    "UPDATE dune.world_partition SET server_id = NULL WHERE map = '$MAP_NAME';" 2>&1 || true
  psql -h postgres -p 5432 -U dune -d "$DB_NAME" -c \
    "DELETE FROM dune.farm_state WHERE map = '$MAP_NAME';" 2>&1 || true
fi

# Start the game server, tee output so we can parse the server_id from
# the game's own log (appears at frame 1: "Server <ID> should be ready").
# We update world_partition immediately when we see it, closing the
# 5-second timing gap before the game queries load_world_partition.
echo "[pre-start] Starting game server for map=$MAP_NAME..."

FIFO="/tmp/.game_output_$$"
mkfifo "$FIFO" 2>/dev/null || true

# Background process: scan game output for server_id and assign partition
(
  ASSIGNED=0
  while IFS= read -r line; do
    if [ "$ASSIGNED" -eq 0 ]; then
      # Match: "Server XXXX should be ready"
      SID=$(echo "$line" | grep -oP 'Server \K[A-Za-z0-9_+/=-]{10,30}(?= should be ready)')
      if [ -n "$SID" ]; then
        echo "[pre-start] Detected server_id=$SID, assigning partition..."
        psql -h postgres -p 5432 -U dune -d "$DB_NAME" -c \
          "UPDATE dune.world_partition SET server_id = '$SID' WHERE map = '$MAP_NAME';" 2>&1 || true
        ASSIGNED=1
        echo "[pre-start] Partition assigned to $SID"
      fi
    fi
  done < "$FIFO"
) &
SCANNER_PID=$!

# Run game, tee to both stdout and the FIFO scanner
/home/dune/run.sh "$@" 2>&1 | tee "$FIFO" &
GAME_PID=$!

# Forward signals to the game process
trap "kill $GAME_PID $SCANNER_PID 2>/dev/null; rm -f $FIFO" SIGTERM SIGINT EXIT

# Wait for game to exit
wait $GAME_PID 2>/dev/null
EXIT_CODE=$?
kill $SCANNER_PID 2>/dev/null
rm -f "$FIFO"
exit $EXIT_CODE
