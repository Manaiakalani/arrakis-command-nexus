#!/usr/bin/env bash
# Load Funcom Docker image tarballs from the Steam dedicated server package.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

print_banner
require_command docker
require_command find

docker_daemon_ok || die 'Docker daemon is not running.'

steam_dir="$(strip_wrapping_quotes "${DUNE_STEAM_SERVER_DIR:-}")"
while [[ -z "$steam_dir" || ! -d "$steam_dir" ]]; do
  steam_dir="$(prompt_input 'Path to the Steam dedicated server directory' "$steam_dir")"
  [[ -d "$steam_dir" ]] || log_warn 'That path does not exist. Please enter a valid directory.'
done
set_env_value DUNE_STEAM_SERVER_DIR "$steam_dir"

mapfile -t tarballs < <(find "$steam_dir" -maxdepth 4 -type f \( -name '*.tar' -o -name '*.tar.gz' \) | sort)
((${#tarballs[@]} > 0)) || die "No Docker image tarballs were found under $steam_dir"

declare -a loaded_tags=()
for tarball in "${tarballs[@]}"; do
  log_step "Loading image tarball: $tarball"
  load_output="$(docker load -i "$tarball" 2>&1)"
  printf '%s\n' "$load_output"

  while IFS= read -r tag; do
    [[ -n "$tag" ]] || continue
    loaded_tags+=("$tag")
  done < <(printf '%s\n' "$load_output" | awk -F': ' '/Loaded image:/ { print $2 }')
done

((${#loaded_tags[@]} > 0)) || die 'docker load completed, but no image tags were reported.'

discovered_tag=''
for image_ref in "${loaded_tags[@]}"; do
  if [[ "$image_ref" == *seabass-server* || "$image_ref" == *dune* ]]; then
    discovered_tag="${image_ref##*:}"
  fi
done

if [[ -z "$discovered_tag" ]]; then
  discovered_tag="${loaded_tags[-1]##*:}"
fi

set_env_value DUNE_IMAGE_TAG "$discovered_tag"
load_env_file

printf '\nLoaded image tags:\n'
printf '  - %s\n' "${loaded_tags[@]}"
printf '\nDetected image tag: %s\n' "$discovered_tag"
log_success 'Updated DUNE_IMAGE_TAG in .env.'