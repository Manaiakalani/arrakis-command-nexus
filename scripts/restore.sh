#!/usr/bin/env bash
# Restore helper for Dune Awakening self-hosted server data.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

usage() {
  printf 'Usage: %s <backup-file|backup-meta>\n' "$(basename "$0")"
}

restore_database_dump() {
  local dump_file="$1"

  log_step 'Ensuring PostgreSQL is running.'
  run_compose up -d postgres >/dev/null

  log_step "Restoring database from $dump_file"
  run_compose exec -T \
    -e PGPASSWORD="${POSTGRES_DUNE_PASSWORD:-}" \
    postgres pg_restore \
    -U "${POSTGRES_USER:-dune}" \
    -d "${POSTGRES_DB_NAME:-${POSTGRES_DB:-dune_sb_1_4_0_0}}" \
    --clean --if-exists < "$dump_file"
}

restore_config_archive() {
  local archive_file="$1"
  log_step "Restoring config archive $archive_file"
  tar -xzf "$archive_file" -C "$PROJECT_ROOT"
}

validate_restored_database() {
  local db_name="${POSTGRES_DB_NAME:-${POSTGRES_DB:-dune_sb_1_4_0_0}}"
  local farm_state_exists world_partition_exists

  log_step 'Validating restored database objects.'
  farm_state_exists="$(run_compose exec -T postgres \
    psql -U "${POSTGRES_USER:-dune}" -d "$db_name" -tAc \
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'dune' AND table_name = 'farm_state');" 2>/dev/null || true)"
  world_partition_exists="$(run_compose exec -T postgres \
    psql -U "${POSTGRES_USER:-dune}" -d "$db_name" -tAc \
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'dune' AND table_name = 'world_partition');" 2>/dev/null || true)"

  farm_state_exists="${farm_state_exists//[[:space:]]/}"
  world_partition_exists="${world_partition_exists//[[:space:]]/}"

  if [[ "$farm_state_exists" == 't' && "$world_partition_exists" == 't' ]]; then
    log_success 'Post-restore validation passed: dune.farm_state and dune.world_partition are present.'
    return 0
  fi

  log_warn 'Post-restore validation failed: expected core Dune tables were not found.'
  return 1
}

[[ $# -eq 1 ]] || {
  usage
  exit 1
}

backup_file="$1"
[[ -f "$backup_file" ]] || die "Backup file not found: $backup_file"

print_banner
require_command docker
require_command tar

docker_daemon_ok || die 'Docker daemon is not running.'
confirm 'This will overwrite current data. Continue?' 'N' || {
  log_warn 'Restore cancelled.'
  exit 1
}

mapfile -t restart_services < <(game_services)
if ((${#restart_services[@]} > 0)); then
  log_step 'Stopping game services before restore.'
  run_compose stop "${restart_services[@]}"
fi

database_restored='false'
config_restored='false'

case "$backup_file" in
  *.dump)
    restore_database_dump "$backup_file"
    database_restored='true'
    ;;
  *.tar.gz)
    restore_config_archive "$backup_file"
    config_restored='true'
    ;;
  *.meta)
    while IFS='=' read -r key value; do
      case "$key" in
        files)
          IFS=',' read -r -a listed_files <<< "$value"
          ;;
      esac
    done < "$backup_file"

    for listed_file in "${listed_files[@]:-}"; do
      # Resolve bare filenames relative to BACKUP_DIR
      if [[ "$listed_file" != /* ]] && [[ -f "$BACKUP_DIR/$listed_file" ]]; then
        listed_file="$BACKUP_DIR/$listed_file"
      fi
      [[ -f "$listed_file" ]] || continue
      case "$listed_file" in
        *.dump)
          restore_database_dump "$listed_file"
          database_restored='true'
          ;;
        *.tar.gz)
          restore_config_archive "$listed_file"
          config_restored='true'
          ;;
      esac
    done
    ;;
  *)
    die 'Unsupported backup type. Expected .dump, .tar.gz, or .meta.'
    ;;
esac

if ((${#restart_services[@]} > 0)); then
  log_step 'Restarting game services.'
  run_compose up -d "${restart_services[@]}"
fi

if [[ "$database_restored" == 'true' ]]; then
  validate_restored_database
fi

printf '\nRestore completed.\n'
printf '  Database restored: %s\n' "$database_restored"
printf '  Config restored:   %s\n' "$config_restored"
log_success 'Restore finished successfully.'