#!/bin/bash
set -euo pipefail

MAP_NAME="${PARTITION_MAP_NAME:-Survival_1}"
DB_NAME="${POSTGRES_DB_NAME:-dune_sb_1_4_0_0}"
export PGPASSWORD="${POSTGRES_DUNE_PASSWORD:-change-me-dune-db}"

# Write Bgd.ServerDisplayName to UserEngine.ini before the game starts.
# The -ini:engine:[ConsoleVariables]:Bgd.ServerDisplayName= command-line arg
# splits on spaces, so we write directly to the UserSettings ini file instead.
# UE5 reads UserSettings from Saved/UserSettings/ (root) AND from
# Saved/<MapName>/UserSettings/ (map-specific subdirectory). We write both
# so the name is applied regardless of which path the binary uses.
SAVED_ROOT="/home/dune/server/DuneSandbox/Saved"
# Per-partition display name overrides DUNE_SERVER_DISPLAY_NAME and WORLD_NAME
DISPLAY_NAME="${PARTITION_DISPLAY_NAME:-${DUNE_SERVER_DISPLAY_NAME:-${WORLD_NAME:-}}}"
if [ -n "$DISPLAY_NAME" ]; then
  write_usersettings_ini() {
    local dir="$1"
    mkdir -p "$dir"
    # Always rewrite so display name changes take effect on restart.
    cat > "$dir/UserEngine.ini" << INIEOF
# arrakis-command-nexus managed -- do not edit manually
[ConsoleVariables]
Bgd.ServerDisplayName=$DISPLAY_NAME
INIEOF
    echo "[pre-start] Wrote Bgd.ServerDisplayName='$DISPLAY_NAME' to $dir/UserEngine.ini"
  }
  # Root-level UserSettings (read by some map binaries)
  write_usersettings_ini "$SAVED_ROOT/UserSettings"
  # Map-specific subdirectory (UE5 per-map SavedDir — Overmap uses Saved/Overmap/, etc.)
  write_usersettings_ini "$SAVED_ROOT/$MAP_NAME/UserSettings"
fi

# Crash-cooldown: if the server crashed recently, wait before restarting
# to avoid CPU/memory thrashing from rapid restart loops.
CRASH_MARKER="/tmp/.dune_server_crash_marker"
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

# Clear stale farm_state entries before restarting.
# world_partition records are managed by partition_repair.py which updates the
# server_id as soon as the new server_id appears in farm_state (~3 seconds).
# The patched load_world_partition() fallback path now also accepts Overmap
# partitions (map='Overmap' OR map=in_map_name), so even if partition_repair
# hasn't run yet, the game can claim the unassigned Overmap partition directly.
echo "[pre-start] Clearing stale farm_state data for map='$MAP_NAME'..."
if [[ ! "$MAP_NAME" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "[pre-start] ERROR: Invalid MAP_NAME '$MAP_NAME'"
  exit 1
fi

# Clear stale farm_state entries (MAP_NAME is validated above).
# Do NOT delete world_partition: the existing record (with old server_id) can be
# claimed by the new server via the fallback path in load_world_partition().
psql -v ON_ERROR_STOP=1 -h postgres -p 5432 -U dune -d "$DB_NAME" -c \
  "DELETE FROM dune.farm_state WHERE map = '$MAP_NAME';" 2>/dev/null || echo "[pre-start] Note: farm_state table may not exist yet (first boot). Continuing."

# Start the game server. Tee output to a FIFO so a background scanner
# can detect the server_id from stdout ("Server <ID> should be ready")
# and then wait for that ID to appear in farm_state (FK requirement)
# before inserting the world_partition row (fallback in case partition_repair
# hasn't already assigned one).
echo "[pre-start] Starting game server for map='$MAP_NAME'..."

FIFO_DIR="$(mktemp -d /tmp/.game_fifo.XXXXXX)"
FIFO="${FIFO_DIR}/pipe"
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

  rm -rf "${FIFO_DIR:-}"
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
          EXISTS=$(psql -v ON_ERROR_STOP=1 -h postgres -p 5432 -U dune -d "$DB_NAME" -t -A -c \
            "SELECT 1 FROM dune.farm_state WHERE server_id = '$SID' LIMIT 1;")
          if [ "$EXISTS" = "1" ]; then
          echo "[pre-start] farm_state registered (${i}s), claiming partition for map='$MAP_NAME'..."
            PART_DEF='{"box": {"max_x": 1, "max_y": 1, "min_x": 0, "min_y": 0}, "type": "box2d_array"}'
          # Try to claim an existing unassigned partition first (UPDATE).
          # This avoids the determine_partition_label_trigger UNIQUE conflict
          # that occurs when a labelled row (e.g. Overmap/Overland) already
          # exists and we attempt a second INSERT for the same map type.
          CLAIMED=$(psql -h postgres -p 5432 -U dune -d "$DB_NAME" -t -A \
            -c "UPDATE dune.world_partition SET server_id = '$SID'
                WHERE partition_id = (
                  SELECT partition_id FROM dune.world_partition
                  WHERE map = '$MAP_NAME'
                    AND (server_id IS NULL
                         OR server_id NOT IN (SELECT server_id FROM dune.active_server_ids))
                  ORDER BY partition_id LIMIT 1
                  FOR UPDATE SKIP LOCKED
                ) RETURNING partition_id;" 2>/dev/null || echo "")
          if [ -n "$CLAIMED" ]; then
            echo "[pre-start] Claimed existing partition_id=$CLAIMED for $SID"
          else
            # No existing partition for this map (first boot) — insert a new one.
            psql -h postgres -p 5432 -U dune -d "$DB_NAME" \
              -c "INSERT INTO dune.world_partition (server_id, map, partition_definition, dimension_index)
                  VALUES ('$SID', '$MAP_NAME', CAST('$PART_DEF' AS jsonb), 0)
                  ON CONFLICT DO NOTHING;" 2>/dev/null || true
            echo "[pre-start] Inserted new partition for $SID (first boot)"
          fi
          ASSIGNED=1
          break
          fi
          sleep 1
        done
        if [ "$ASSIGNED" -eq 0 ]; then
          echo "[pre-start] WARNING: farm_state registration timed out for $SID"
        fi

        # Fix world_partition_reset_seed after the game server initializes.
        # The game server resets this value to its default (2) on every boot.
        # If we restored buildings from a backup with a different seed (e.g. 1),
        # the mismatch triggers "A storm has reset the map" and hides all buildings.
        # WORLD_RESET_SEED env var overrides the seed after startup to prevent this.
        RESET_SEED="${WORLD_RESET_SEED:-}"
        if [ -n "$RESET_SEED" ]; then
          # The game server resets world_partition_reset_seed during its late
          # initialization (after farm becomes READY). We run a retry loop that
          # keeps overriding the seed until it sticks (server stops changing it).
          (
            PART_ID=""
            for attempt in $(seq 1 6); do
              sleep 20
              if [ -z "$PART_ID" ]; then
                PART_ID=$(psql -h postgres -p 5432 -U dune -d "$DB_NAME" -t -A -c \
                  "SELECT partition_id FROM dune.world_partition WHERE server_id = '$SID' LIMIT 1;" 2>/dev/null || echo "")
              fi
              if [ -n "$PART_ID" ]; then
                CUR_SEED=$(psql -h postgres -p 5432 -U dune -d "$DB_NAME" -t -A -c \
                  "SELECT world_reset_seed FROM dune.world_partition_reset_seed WHERE partition_id = $PART_ID;" 2>/dev/null || echo "")
                if [ "$CUR_SEED" != "$RESET_SEED" ]; then
                  psql -h postgres -p 5432 -U dune -d "$DB_NAME" -c \
                    "UPDATE dune.world_partition_reset_seed SET world_reset_seed = $RESET_SEED WHERE partition_id = $PART_ID;" 2>/dev/null || true
                  echo "[pre-start] Fixed world_partition_reset_seed=$RESET_SEED for partition_id=$PART_ID (attempt $attempt, was $CUR_SEED)"
                else
                  echo "[pre-start] world_partition_reset_seed=$CUR_SEED already correct for partition_id=$PART_ID (attempt $attempt)"
                  break
                fi
              fi
            done
          ) &
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
