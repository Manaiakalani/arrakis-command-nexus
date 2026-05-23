#!/bin/bash
MAP_NAME="${PARTITION_MAP_NAME:-Survival_1}"
DB_NAME="${POSTGRES_DB_NAME:-dune_sb_1_4_0_0}"
export PGPASSWORD="${POSTGRES_DUNE_PASSWORD:-change-me-dune-db}"
echo "[pre-start] Clearing stale server_id for map=$MAP_NAME..."
psql -h postgres -p 5432 -U dune -d "$DB_NAME" -c "UPDATE dune.world_partition SET server_id = NULL WHERE map = '$MAP_NAME';" 2>&1 || true
echo "[pre-start] Done, starting game server..."
exec /home/dune/run.sh "$@"