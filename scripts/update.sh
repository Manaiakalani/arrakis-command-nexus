#!/usr/bin/env bash
# Refresh Dune Awakening dedicated server files and reload Docker images.
#
# ## Steps
# 1. backup - create a full pre-update backup.
# 2. stop - stop the docker compose stack before replacing files.
# 3. download - use steamcmd to download or validate the server package.
# 4. load - run scripts/load-images.sh to load Docker image tarballs.
# 5. tag - reload .env and report the resulting DUNE_IMAGE_TAG.
# 6. restart - optionally recreate containers with the updated images.
#
# Resume examples:
#   ./scripts/update.sh --skip-backup --skip-download
#   ./scripts/update.sh --start-after load
#   ./scripts/update.sh --dry-run --start-after download --skip-restart

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

DRY_RUN='false'
SKIP_BACKUP='false'
SKIP_STOP='false'
SKIP_DOWNLOAD='false'
SKIP_LOAD='false'
SKIP_RESTART='false'
START_AFTER=''
declare -a POSITIONAL_ARGS=()

declare -a UPDATE_STEPS=(backup stop download load tag restart)

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Refresh Dune Awakening dedicated server files, load new Docker images, update
DUNE_IMAGE_TAG, and recreate the compose stack. Skip flags are intended for
resuming after a partial failure when a phase already completed successfully.

Options:
  --skip-backup       Skip the pre-update backup step.
  --skip-stop         Skip docker compose down because the stack is already stopped.
  --skip-download     Skip steamcmd download because steam-live is already populated.
  --skip-load         Skip docker load because the new images are already loaded.
  --skip-restart      Skip the final container recreate.
  --start-after STEP  Resume from STEP and skip everything before it.
                      Valid steps: backup, stop, download, load, tag, restart.
  --dry-run           Print what would happen, change nothing.
  --help              Show this help text.

## Steps
  backup    Create a full pre-update backup. Use --skip-backup when you already
            have a current backup.
  stop      Run docker compose down so files and images can be updated cleanly.
  download  Run steamcmd to download or validate the server package into the
            configured Steam dedicated server directory.
  load      Run scripts/load-images.sh to docker load the image tarballs and
            mirror tags as needed.
  tag       Reload .env and show the old and new DUNE_IMAGE_TAG values.
  restart   Ask whether to recreate the stack with the updated images.

Examples:
  $(basename "$0")
  $(basename "$0") --skip-backup --start-after download
  $(basename "$0") --dry-run --start-after load --skip-restart
EOF
}

step_index() {
  local needle="$1"
  local idx

  for idx in "${!UPDATE_STEPS[@]}"; do
    if [[ "${UPDATE_STEPS[$idx]}" == "$needle" ]]; then
      printf '%s\n' "$idx"
      return 0
    fi
  done

  return 1
}

valid_step() {
  step_index "$1" >/dev/null 2>&1
}

set_step_skip() {
  local step="$1"
  local value="$2"

  case "$step" in
    backup) SKIP_BACKUP="$value" ;;
    stop) SKIP_STOP="$value" ;;
    download) SKIP_DOWNLOAD="$value" ;;
    load) SKIP_LOAD="$value" ;;
    restart) SKIP_RESTART="$value" ;;
    tag) : ;;
    *) die "Unknown update step: $step" ;;
  esac
}

should_run_step() {
  local step="$1"

  case "$step" in
    backup) [[ "$SKIP_BACKUP" != 'true' ]] ;;
    stop) [[ "$SKIP_STOP" != 'true' ]] ;;
    download) [[ "$SKIP_DOWNLOAD" != 'true' ]] ;;
    load) [[ "$SKIP_LOAD" != 'true' ]] ;;
    tag) true ;;
    restart) [[ "$SKIP_RESTART" != 'true' ]] ;;
    *) return 1 ;;
  esac
}

step_description() {
  case "$1" in
    backup) printf 'create pre-update backup\n' ;;
    stop) printf 'docker compose down\n' ;;
    download) printf 'steamcmd server package download\n' ;;
    load) printf 'docker load image tarballs\n' ;;
    tag) printf 'reload and report DUNE_IMAGE_TAG\n' ;;
    restart) printf 'container recreate prompt\n' ;;
    *) printf 'unknown\n' ;;
  esac
}

apply_start_after() {
  local start_idx
  local idx

  [[ -n "$START_AFTER" ]] || return 0
  valid_step "$START_AFTER" || die "Invalid --start-after step: $START_AFTER"
  start_idx="$(step_index "$START_AFTER")"

  for idx in "${!UPDATE_STEPS[@]}"; do
    if (( idx < start_idx )); then
      set_step_skip "${UPDATE_STEPS[$idx]}" 'true'
    fi
  done
}

print_step_plan() {
  local step
  local state

  printf '\nUpdate step plan:\n'
  for step in "${UPDATE_STEPS[@]}"; do
    if should_run_step "$step"; then
      state='RUN'
    else
      state='SKIP'
    fi
    printf '  %-8s %s - %s\n' "$state" "$step" "$(step_description "$step")"
  done
  if [[ "$DRY_RUN" == 'true' ]]; then
    printf '  DRY-RUN  no commands will change files, images, or containers\n'
  fi
  printf '\n'
}

parse_args() {
  local arg

  while (($#)); do
    arg="$1"
    case "$arg" in
      --skip-backup)
        SKIP_BACKUP='true'
        shift
        ;;
      --skip-stop)
        SKIP_STOP='true'
        shift
        ;;
      --skip-download)
        SKIP_DOWNLOAD='true'
        shift
        ;;
      --skip-load)
        SKIP_LOAD='true'
        shift
        ;;
      --skip-restart)
        SKIP_RESTART='true'
        shift
        ;;
      --start-after)
        shift
        (($#)) || die '--start-after requires a step name.'
        START_AFTER="$1"
        shift
        ;;
      --start-after=*)
        START_AFTER="${arg#--start-after=}"
        shift
        ;;
      --dry-run)
        DRY_RUN='true'
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      --)
        shift
        POSITIONAL_ARGS+=("$@")
        break
        ;;
      --*)
        die "Unknown option: $arg"
        ;;
      *)
        POSITIONAL_ARGS+=("$arg")
        shift
        ;;
    esac
  done

  apply_start_after
}

install_steamcmd() {
  if ! have_command sudo || ! have_command apt-get; then
    die 'steamcmd is missing. Install it manually, then rerun this script.'
  fi

  log_step 'Installing steamcmd via apt-get.'
  sudo apt-get update
  sudo apt-get install -y steamcmd
}

run_backup_step() {
  if [[ "$DRY_RUN" == 'true' ]]; then
    log_info 'Dry run: would create a full pre-update backup.'
    return 0
  fi

  log_step 'Creating pre-update backup...'
  "$SCRIPT_DIR/backup.sh" --scope full || log_warn 'Pre-update backup failed. Proceeding anyway.'
}

run_stop_step() {
  if [[ "$DRY_RUN" == 'true' ]]; then
    log_info 'Dry run: would run docker compose down.'
    return 0
  fi

  log_step 'Stopping the Dune stack.'
  run_compose down
  log_success 'Stack stopped.'
}

run_download_step() {
  if [[ "$DRY_RUN" == 'true' ]]; then
    log_info 'Dry run: would verify steamcmd is available.'
    log_info "Dry run: would download app ${steam_app_id:-<prompted Steam App ID>} into ${steam_dir:-<prompted Steam dedicated server directory>}."
    return 0
  fi

  if ! have_command steamcmd; then
    log_warn 'steamcmd is not installed.'
    if confirm 'Install steamcmd automatically (requires sudo)?' 'N'; then
      install_steamcmd
    else
      die 'steamcmd is required to update the server files.'
    fi
  fi

  while [[ -z "$steam_app_id" ]]; do
    steam_app_id="$(prompt_input 'Steam App ID')"
    [[ -n "$steam_app_id" ]] || log_warn 'The Steam App ID cannot be empty.'
  done
  set_env_value STEAM_APP_ID "$steam_app_id"

  while [[ -z "$steam_dir" || ! -d "$steam_dir" ]]; do
    steam_dir="$(prompt_input 'Steam dedicated server directory' "$steam_dir")"
    [[ -d "$steam_dir" ]] || log_warn 'Please enter a valid server directory.'
  done
  set_env_value DUNE_STEAM_SERVER_DIR "$steam_dir"

  log_step 'Downloading the latest Funcom server package via steamcmd.'
  steamcmd +@sSteamCmdForcePlatformType linux +force_install_dir "$steam_dir" +login anonymous +app_update "$steam_app_id" validate +quit
}

run_load_step() {
  if [[ "$DRY_RUN" == 'true' ]]; then
    log_info 'Dry run: would run scripts/load-images.sh.'
    return 0
  fi

  "$PROJECT_ROOT/scripts/load-images.sh"
}

run_tag_step() {
  if [[ "$DRY_RUN" == 'true' ]]; then
    log_info 'Dry run: would reload .env and print the image tag summary.'
    return 0
  fi

  load_env_file
  new_tag="$(strip_wrapping_quotes "${DUNE_IMAGE_TAG:-unknown}")"

  printf '\nImage tag update summary:\n'
  printf '  Old tag: %s\n' "$old_tag"
  printf '  New tag: %s\n' "$new_tag"
}

run_restart_step() {
  if [[ "$DRY_RUN" == 'true' ]]; then
    log_info 'Dry run: would ask whether to recreate the stack and run dune restart if confirmed.'
    return 0
  fi

  if confirm 'Restart the stack with the updated images now?' 'Y'; then
    "$PROJECT_ROOT/dune" restart
    sync_dashboard_update_state
  else
    log_info 'Restart skipped. Run dune restart when you are ready.'
  fi
}

sync_dashboard_update_state() {
  # Notify the dashboard API that the update completed so it clears the
  # "update available" notification (and Discord alert).  Best-effort only.
  local api_port admin_token api_url
  api_port="$(strip_wrapping_quotes "${DASHBOARD_API_PORT:-8080}")"
  admin_token="$(strip_wrapping_quotes "${DUNE_ADMIN_TOKEN:-}")"

  if [[ -z "$admin_token" ]]; then
    log_info 'No DUNE_ADMIN_TOKEN set — skipping dashboard update sync.'
    return 0
  fi

  # Try container-internal first (API port is not host-mapped), then localhost
  api_url="http://localhost:${api_port}/api/updates/mark-current"
  if have_command docker && run_compose exec -T dashboard-api \
       curl -fsS -X POST "http://localhost:8080/api/updates/mark-current" \
       -H "X-Admin-Token: ${admin_token}" >/dev/null 2>&1; then
    log_success 'Dashboard notified: server marked as up-to-date.'
  elif have_command curl && curl -fsS -X POST "$api_url" \
       -H "X-Admin-Token: ${admin_token}" >/dev/null 2>&1; then
    log_success 'Dashboard notified: server marked as up-to-date.'
  else
    log_warn 'Could not reach dashboard API to clear update notification.'
    log_warn "Run manually: curl -X POST $api_url -H 'X-Admin-Token: <token>'"
  fi
}

parse_args "$@"

print_banner

old_tag="$(strip_wrapping_quotes "${DUNE_IMAGE_TAG:-unknown}")"
new_tag="$old_tag"
steam_dir="$(strip_wrapping_quotes "${DUNE_STEAM_SERVER_DIR:-}")"
steam_app_id="$(strip_wrapping_quotes "${STEAM_APP_ID:-}")"

print_step_plan

if [[ "$DRY_RUN" != 'true' ]]; then
  if should_run_step stop || should_run_step load || should_run_step restart; then
    require_command docker
  fi
fi

if should_run_step backup; then
  run_backup_step
else
  log_info 'Skipping backup step.'
fi

if should_run_step stop; then
  run_stop_step
else
  log_info 'Skipping stop step.'
fi

if should_run_step download; then
  run_download_step
else
  log_info 'Skipping download step.'
fi

if should_run_step load; then
  run_load_step
else
  log_info 'Skipping load step.'
fi

if should_run_step tag; then
  run_tag_step
fi

if should_run_step restart; then
  run_restart_step
else
  log_info 'Skipping restart step.'
fi
