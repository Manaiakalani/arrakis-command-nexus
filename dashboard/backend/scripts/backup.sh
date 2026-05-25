#!/usr/bin/env bash
# Container-compatible backup script for the dashboard-api container.
# Runs pg_dump against the game database and/or archives mounted config.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/workspace/backups}"
CONFIG_DIR="${DUNE_CONFIG_DIR:-/workspace/config}"
POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-dune_sb_1_4_0_0}"
POSTGRES_USER="${POSTGRES_USER:-dune}"

export PGPASSWORD="${POSTGRES_PASSWORD:-}"

scope='full'
while (($# > 0)); do
  case "$1" in
    --scope) shift; scope="${1:-full}" ;;
    --help|-h) printf 'Usage: %s [--scope full|config|db]\n' "$(basename "$0")"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
  shift || true
done

case "$scope" in
  full|config|db) ;;
  *) echo "Backup scope must be one of: full, config, db" >&2; exit 1 ;;
esac

mkdir -p "$BACKUP_DIR"
timestamp="$(date +%Y%m%d-%H%M%S)"
created_files=()

backup_database() {
  local dump_file="$BACKUP_DIR/dune-db__${timestamp}.sql.gz"
  echo "Creating PostgreSQL backup: $dump_file"
  pg_dump -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" "$POSTGRES_DB" \
    | gzip > "$dump_file"
  created_files+=("$dump_file")
}

backup_config() {
  local config_archive="$BACKUP_DIR/dune-config__${timestamp}.tar.gz"
  if [ ! -d "$CONFIG_DIR" ]; then
    echo "Config directory $CONFIG_DIR does not exist, skipping config backup" >&2
    return
  fi
  echo "Archiving configuration: $config_archive"
  tar -czf "$config_archive" -C "$(dirname "$CONFIG_DIR")" "$(basename "$CONFIG_DIR")"
  created_files+=("$config_archive")
}

case "$scope" in
  db)       backup_database ;;
  config)   backup_config ;;
  full)     backup_database; backup_config ;;
esac

# Write metadata
meta_file="$BACKUP_DIR/dune-${scope}__${timestamp}.meta"
cat > "$meta_file" <<EOF
scope=$scope
timestamp=$timestamp
files=$(printf '%s,' "${created_files[@]##*/}" | sed 's/,$//')
EOF
created_files+=("$meta_file")

printf '\nCreated backup artifacts:\n'
for f in "${created_files[@]}"; do
  size=$(stat -c%s "$f" 2>/dev/null || echo "0")
  printf '  - %s (%s bytes)\n' "$f" "$size"
done
echo "Backup completed successfully."
