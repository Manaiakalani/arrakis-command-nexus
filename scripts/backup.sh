#!/usr/bin/env bash
# Backup helper for Dune Awakening self-hosted server data.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

usage() {
  printf 'Usage: %s [--scope full|config|db] [--dry-run]\n' "$(basename "$0")"
}

scope='full'
dry_run='false'
while (($# > 0)); do
  case "$1" in
    --scope)
      shift
      scope="${1:-}"
      ;;
    --dry-run)
      dry_run='true'
      ;;
    --help|-h)
      usage
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

keep_n="$(strip_wrapping_quotes "${BACKUP_KEEP_N:-14}")"
retention_days="$(strip_wrapping_quotes "${BACKUP_RETENTION_DAYS:-30}")"
[[ "$keep_n" =~ ^[0-9]+$ ]] || die 'BACKUP_KEEP_N must be a non-negative integer.'
[[ "$retention_days" =~ ^[0-9]+$ ]] || die 'BACKUP_RETENTION_DAYS must be a non-negative integer.'

timestamp=''
map_list=''
meta_file=''
declare -a created_files=()

backup_database() {
  local dump_file="$BACKUP_DIR/dune-db-${scope}__${timestamp}.dump"
  log_step "Creating PostgreSQL backup: $dump_file"
  run_compose exec -T \
    -e PGPASSWORD="${POSTGRES_DUNE_PASSWORD:-}" \
    postgres pg_dump -Fc \
    -U "${POSTGRES_USER:-dune}" \
    "${POSTGRES_DB_NAME:-${POSTGRES_DB:-dune_sb_1_4_0_0}}" > "$dump_file"
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

file_mtime_epoch() {
  stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1"
}

file_size_bytes() {
  stat -c '%s' "$1" 2>/dev/null || stat -f '%z' "$1"
}

human_bytes() {
  awk -v bytes="$1" '
    BEGIN {
      split("B KiB MiB GiB TiB", units, " ")
      value = bytes + 0
      unit = 1
      while (value >= 1024 && unit < 5) {
        value = value / 1024
        unit++
      }
      if (unit == 1) {
        printf "%d %s", value, units[unit]
      } else {
        printf "%.1f %s", value, units[unit]
      }
    }
  '
}

prune_old_backups() {
  log_step "Pruning backups with BACKUP_KEEP_N=$keep_n and BACKUP_RETENTION_DAYS=$retention_days."

  local -a backup_candidates=()
  local -a sorted_backups=()
  local file_path newer_file current_epoch cutoff_epoch freed_bytes size_bytes
  local -i i j deleted_count kept_count
  declare -A backup_mtimes

  while IFS= read -r -d '' file_path; do
    backup_candidates+=("$file_path")
    backup_mtimes["$file_path"]="$(file_mtime_epoch "$file_path")"
  done < <(
    find "$BACKUP_DIR" -maxdepth 1 -type f \( \
      -name 'dune-backup-*.tar.gz' -o \
      -name 'dune-*.dump' -o \
      -name 'dune-*.tar.gz' -o \
      -name 'dune-*.meta' \
    \) -print0
  )

  if ((${#backup_candidates[@]} == 0)); then
    printf '  - No backup artifacts found in %s.\n' "$BACKUP_DIR"
    return 0
  fi

  sorted_backups=("${backup_candidates[@]}")
  for ((i = 0; i < ${#sorted_backups[@]}; i++)); do
    for ((j = i + 1; j < ${#sorted_backups[@]}; j++)); do
      file_path="${sorted_backups[$i]}"
      newer_file="${sorted_backups[$j]}"
      if (( ${backup_mtimes[$newer_file]} > ${backup_mtimes[$file_path]} )); then
        sorted_backups[$i]="$newer_file"
        sorted_backups[$j]="$file_path"
      fi
    done
  done

  current_epoch="$(date +%s)"
  cutoff_epoch=$((current_epoch - retention_days * 86400))
  freed_bytes=0
  deleted_count=0
  kept_count=0

  for ((i = 0; i < ${#sorted_backups[@]}; i++)); do
    file_path="${sorted_backups[$i]}"
    if (( i < keep_n )); then
      printf '  - Kept newest: %s\n' "$file_path"
      kept_count+=1
      continue
    fi

    if (( ${backup_mtimes[$file_path]} >= cutoff_epoch )); then
      printf '  - Kept recent: %s\n' "$file_path"
      kept_count+=1
      continue
    fi

    size_bytes="$(file_size_bytes "$file_path")"
    freed_bytes=$((freed_bytes + size_bytes))
    if [[ "$dry_run" == 'true' ]]; then
      printf '  - Would delete: %s (%s)\n' "$file_path" "$(human_bytes "$size_bytes")"
    else
      rm -f -- "$file_path"
      printf '  - Deleted: %s (%s)\n' "$file_path" "$(human_bytes "$size_bytes")"
    fi
    deleted_count+=1
  done

  if [[ "$dry_run" == 'true' ]]; then
    printf 'Dry run complete: kept %d, would delete %d, would free %s.\n' "$kept_count" "$deleted_count" "$(human_bytes "$freed_bytes")"
  else
    printf 'Prune complete: kept %d, deleted %d, freed %s.\n' "$kept_count" "$deleted_count" "$(human_bytes "$freed_bytes")"
  fi
}

print_banner
require_command find
require_command date
require_command stat
ensure_directory "$BACKUP_DIR"

if [[ "$dry_run" == 'true' ]]; then
  prune_old_backups
  log_success 'Backup prune dry run completed successfully.'
  exit 0
fi

require_command docker
require_command tar
require_command du

docker_daemon_ok || die 'Docker daemon is not running.'

timestamp="$(date +%Y%m%d-%H%M%S)"
map_list="$(game_services | paste -sd ',' -)"
[[ -n "$map_list" ]] || map_list='none'
meta_file="$BACKUP_DIR/dune-${scope}__${timestamp}.meta"

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

printf '\nCreated backup artifacts:\n'
for file_path in "${created_files[@]}"; do
  printf '  - %s (%s)\n' "$file_path" "$(human_size "$file_path")"
done

prune_old_backups
log_success 'Backup completed successfully.'
