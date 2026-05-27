#!/usr/bin/env bash
# Backup helper for Dune Awakening self-hosted server data.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

scope='full'
while (($# > 0)); do
  case "$1" in
    --scope)
      shift
      scope="${1:-}"
      ;;
    --help|-h)
      printf 'Usage: %s [--scope full|config|db]\n' "$(basename "$0")"
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
  shift || true
done

case "$scope" in
  full|config|db) ;;
  *) die 'Backup scope must be one of: full, config, db' ;;
esac

print_banner
require_command docker
require_command tar
require_command find
require_command du
require_command date

ensure_directory "$BACKUP_DIR"
docker_daemon_ok || die 'Docker daemon is not running.'

retention_days="$(strip_wrapping_quotes "${BACKUP_RETENTION_DAYS:-14}")"
timestamp="$(date +%Y%m%d-%H%M%S)"
map_list="$(game_services | paste -sd ',' -)"
[[ -n "$map_list" ]] || map_list='none'
meta_file="$BACKUP_DIR/dune-${scope}__${timestamp}.meta"

declare -a created_files=()

backup_database() {
  local dump_file="$BACKUP_DIR/dune-db-${scope}__${timestamp}.dump"
  log_step "Creating PostgreSQL backup: $dump_file"
  run_compose exec -T postgres pg_dump -Fc -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-dune_sb_1_4_0_0}" > "$dump_file"
  created_files+=("$dump_file")
}

backup_config() {
  local config_archive="$BACKUP_DIR/dune-config-${scope}__${timestamp}.tar.gz"
  local -a archive_inputs=()

  [[ -d "$CONFIG_DIR" ]] && archive_inputs+=(config)
  [[ -f "$PROJECT_ROOT/.env" ]] && archive_inputs+=(.env)
  ((${#archive_inputs[@]} > 0)) || die 'Nothing to archive for config scope.'

  log_step "Archiving configuration: $config_archive"
  tar -czf "$config_archive" -C "$PROJECT_ROOT" "${archive_inputs[@]}"
  created_files+=("$config_archive")
}

case "$scope" in
  db)
    backup_database
    ;;
  config)
    backup_config
    ;;
  full)
    backup_database
    backup_config
    ;;
esac

container_states="$(run_compose ps --format json 2>/dev/null || true)"
cat > "$meta_file" <<EOF
scope=$scope
timestamp=$timestamp
profile=$DEPLOYMENT_PROFILE
maps=$map_list
container_states=$container_states
files=$(printf '%s,' "${created_files[@]##*/}" | sed 's/,$//')
EOF
created_files+=("$meta_file")

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'dune-*.dump' -o -name 'dune-*.tar.gz' -o -name 'dune-*.meta' \) -mtime "+$retention_days" -print -delete >/dev/null 2>&1 || true

printf '\nCreated backup artifacts:\n'
for file_path in "${created_files[@]}"; do
  printf '  - %s (%s)\n' "$file_path" "$(human_size "$file_path")"
done
log_success 'Backup completed successfully.'