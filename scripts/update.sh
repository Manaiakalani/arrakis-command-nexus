#!/usr/bin/env bash
# Refresh Dune Awakening dedicated server files and reload Docker images.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

install_steamcmd() {
  if ! have_command sudo || ! have_command apt-get; then
    die 'steamcmd is missing. Install it manually, then rerun this script.'
  fi

  log_step 'Installing steamcmd via apt-get.'
  sudo apt-get update
  sudo apt-get install -y steamcmd
}

print_banner
require_command docker

old_tag="$(strip_wrapping_quotes "${DUNE_IMAGE_TAG:-unknown}")"
steam_dir="$(strip_wrapping_quotes "${DUNE_STEAM_SERVER_DIR:-}")"
steam_app_id="$(strip_wrapping_quotes "${STEAM_APP_ID:-}")"

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
steamcmd +force_install_dir "$steam_dir" +login anonymous +app_update "$steam_app_id" validate +quit

"$PROJECT_ROOT/scripts/load-images.sh"
load_env_file
new_tag="$(strip_wrapping_quotes "${DUNE_IMAGE_TAG:-unknown}")"

printf '\nImage tag update summary:\n'
printf '  Old tag: %s\n' "$old_tag"
printf '  New tag: %s\n' "$new_tag"

if confirm 'Restart the stack with the updated images now?' 'Y'; then
  "$PROJECT_ROOT/dune" restart
else
  log_info 'Restart skipped. Run dune restart when you are ready.'
fi