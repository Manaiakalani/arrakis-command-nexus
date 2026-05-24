#!/bin/bash
MAP_NAME="${PARTITION_MAP_NAME:-Survival_1}"
DB_NAME="${POSTGRES_DB_NAME:-dune_sb_1_4_0_0}"
export PGPASSWORD="${POSTGRES_DUNE_PASSWORD:-change-me-dune-db}"

echo "[pre-start] Clearing stale server_id for map=$MAP_NAME..."
if [[ "$MAP_NAME" =~ ^[A-Za-z0-9_-]+$ ]]; then
  psql -h postgres -p 5432 -U dune -d "$DB_NAME" -v map_name="$MAP_NAME" \
    -c "UPDATE dune.world_partition SET server_id = NULL WHERE map = :'map_name';" 2>&1 || true
else
  echo "[pre-start] Skipping stale server cleanup because PARTITION_MAP_NAME is invalid." >&2
fi

echo "[pre-start] Done, starting game server..."
exec /home/dune/run.sh "$@"