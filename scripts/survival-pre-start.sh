#!/bin/bash
set -euo pipefail

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
echo "[pre-start] Clearing stale partition/farm data for map='$MAP_NAME'..."
if [[ ! "$MAP_NAME" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "[pre-start] ERROR: Invalid MAP_NAME '$MAP_NAME'"
  exit 1
fi

psql -v ON_ERROR_STOP=1 -h postgres -p 5432 -U dune -d "$DB_NAME" -v map_name="$MAP_NAME" -c \
  "DELETE FROM dune.world_partition WHERE map = :'map_name';"
psql -v ON_ERROR_STOP=1 -h postgres -p 5432 -U dune -d "$DB_NAME" -v map_name="$MAP_NAME" -c \
  "DELETE FROM dune.farm_state WHERE map = :'map_name';" || true

# Start the game server. Tee output to a FIFO so a background scanner
# can detect the server_id from stdout ("Server <ID> should be ready")
# and then wait for that ID to appear in farm_state (FK requirement)
# before inserting the world_partition row.
echo "[pre-start] Starting game server for map='$MAP_NAME'..."

FIFO="$(mktemp -u /tmp/.game_fifo.XXXXXX)"
mkfifo "$FIFO"
SCANNER_PID=""
GAME_PID=""
GAME_PGID=""

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if [ -n "${GAME_PGID:-}" ]; then
    kill -- "-${GAME_PGID}" 2>/dev/null || true
  elif [ -n "${GAME_PID:-}" ]; then
    kill "$GAME_PID" 2>/dev/null || true
  fi

  if [ -n "${SCANNER_PID:-}" ]; then
    kill "$SCANNER_PID" 2>/dev/null || true
  fi

  rm -f "$FIFO"
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# Background scanner: detect server_id, wait for farm_state FK, assign partition
(
  ASSIGNED=0
  while IFS= read -r line; do
    if [ "$ASSIGNED" -eq 0 ]; then
      SID=$(printf '%s\n' "$line" | grep -oP 'Server \K[A-Za-z0-9_+/=-]{10,30}(?= should be ready)' || true)
      if [ -n "$SID" ]; then
        echo "[pre-start] Detected server_id=$SID, waiting for farm_state registration..."
        # Poll until this server_id appears in farm_state (FK target)
        for i in $(seq 1 30); do
          EXISTS=$(psql -v ON_ERROR_STOP=1 -h postgres -p 5432 -U dune -d "$DB_NAME" -v server_id="$SID" -t -A -c \
            "SELECT 1 FROM dune.farm_state WHERE server_id = :'server_id' LIMIT 1;")
          if [ "$EXISTS" = "1" ]; then
            echo "[pre-start] farm_state registered (${i}s), inserting partition..."
            psql -v ON_ERROR_STOP=1 -h postgres -p 5432 -U dune -d "$DB_NAME" \
              -v server_id="$SID" \
              -v map_name="$MAP_NAME" \
              -v partition_definition='{"box": {"max_x": 1, "max_y": 1, "min_x": 0, "min_y": 0}, "type": "box2d_array"}' \
              -c "INSERT INTO dune.world_partition (server_id, map, partition_definition, dimension_index)
                  VALUES (:'server_id', :'map_name', CAST(:'partition_definition' AS jsonb), 0)
                  ON CONFLICT DO NOTHING;"
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
GAME_PGID="$(ps -o pgid= -p "$GAME_PID" | tr -d '[:space:]')"

# Wait for game to exit
if wait "$GAME_PID"; then
  EXIT_CODE=0
else
  EXIT_CODE=$?
fi
exit "$EXIT_CODE"
