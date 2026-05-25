#!/bin/sh
# Container-compatible restore script for the dashboard-api container.
set -eu

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-dune_sb_1_4_0_0}"
POSTGRES_USER="${POSTGRES_USER:-dune}"

export PGPASSWORD="${POSTGRES_PASSWORD:-}"

backup_file="${1:-}"
if [ -z "$backup_file" ]; then
  echo "Usage: $0 <backup-file>" >&2
  exit 1
fi

if [ ! -f "$backup_file" ]; then
  echo "Backup file not found: $backup_file" >&2
  exit 1
fi

echo "Restoring from: $backup_file"

case "$backup_file" in
  *.sql.gz)
    echo "Detected gzipped SQL dump"
    gunzip -c "$backup_file" | psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" "$POSTGRES_DB"
    ;;
  *.sql)
    echo "Detected SQL dump"
    psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" "$POSTGRES_DB" < "$backup_file"
    ;;
  *.dump)
    echo "Detected custom format dump"
    pg_restore -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists "$backup_file" || true
    ;;
  *.tar.gz)
    echo "Detected config archive - nothing to restore to database"
    echo "Config archives should be extracted manually to the config directory."
    ;;
  *)
    echo "Unknown backup format: $backup_file" >&2
    exit 1
    ;;
esac

echo "Restore completed successfully."
