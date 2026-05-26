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
    "DELETE FROM dune.world_partition WHERE map = '$MAP_NAME';" 2>&1 || true
  psql -h postgres -p 5432 -U dune -d "$DB_NAME" -c \
    "DELETE FROM dune.farm_state WHERE map = '$MAP_NAME';" 2>&1 || true
fi

# Start the game server. Tee output to a FIFO so a background scanner
# can detect the server_id from stdout ("Server <ID> should be ready")
# and then wait for that ID to appear in farm_state (FK requirement)
# before inserting the world_partition row.
echo "[pre-start] Starting game server for map=$MAP_NAME..."

FIFO="/tmp/.game_output_$$"
mkfifo "$FIFO" 2>/dev/null || true

# Background scanner: detect server_id, wait for farm_state FK, assign partition
(
  ASSIGNED=0
  while IFS= read -r line; do
    if [ "$ASSIGNED" -eq 0 ]; then
      SID=$(echo "$line" | grep -oP 'Server \K[A-Za-z0-9_+/=-]{10,30}(?= should be ready)')
      if [ -n "$SID" ]; then
        echo "[pre-start] Detected server_id=$SID, waiting for farm_state registration..."
        # Poll until this server_id appears in farm_state (FK target)
        for i in $(seq 1 30); do
          EXISTS=$(psql -h postgres -p 5432 -U dune -d "$DB_NAME" -t -A -c \
            "SELECT 1 FROM dune.farm_state WHERE server_id = '$SID' LIMIT 1;" 2>/dev/null)
          if [ "$EXISTS" = "1" ]; then
            echo "[pre-start] farm_state registered (${i}s), inserting partition..."
            psql -h postgres -p 5432 -U dune -d "$DB_NAME" -c \
              "INSERT INTO dune.world_partition (server_id, map, partition_definition, dimension_index)
               VALUES ('$SID', '$MAP_NAME', '{\"box\": {\"max_x\": 1, \"max_y\": 1, \"min_x\": 0, \"min_y\": 0}, \"type\": \"box2d_array\"}', 0)
               ON CONFLICT DO NOTHING;" 2>&1 || true
            ASSIGNED=1
            echo "[pre-start] Partition created for $SID"
            break
          fi
          sleep 1
        done
        if [ "$ASSIGNED" -eq 0 ]; then
          echo "[pre-start] WARNING: farm_state registration timed out for $SID"
        fi
      fi
    fi
  done < "$FIFO"
) &
SCANNER_PID=$!

# Run game, tee to both stdout (container logs) and the FIFO scanner
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
