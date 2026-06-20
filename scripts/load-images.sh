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
    # New Funcom builds ship images namespaced as
    # registry.funcom.com/funcom/self-hosting/<name>:<tag>, but our compose
    # files reference the shorter funcom/self-hosting/<name>:<tag> form (the
    # tags older builds shipped with). Mirror the long form to the short
    # form so `docker compose up` finds the images locally without trying
    # to pull from the registry.
    if [[ "$tag" == registry.funcom.com/* ]]; then
      short="${tag#registry.funcom.com/}"
      if ! docker image inspect "$short" >/dev/null 2>&1; then
        docker tag "$tag" "$short" && log_step "Mirrored tag: $tag -> $short"
      fi
    fi
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

# Never downgrade: compare the numeric CL of the discovered tag against the
# currently configured tag and keep whichever is higher.
current_tag="$(strip_wrapping_quotes "${DUNE_IMAGE_TAG:-0}")"
current_cl="${current_tag%%-*}"
discovered_cl="${discovered_tag%%-*}"

printf '\nLoaded image tags:\n'
printf '  - %s\n' "${loaded_tags[@]}"
printf '\nDetected image tag: %s\n' "$discovered_tag"

if [[ "$discovered_cl" =~ ^[0-9]+$ && "$current_cl" =~ ^[0-9]+$ ]] && \
   (( discovered_cl < current_cl )); then
  log_warn "Steam build CL ${discovered_cl} is older than the running CL ${current_cl}."
  log_warn "Keeping DUNE_IMAGE_TAG=${current_tag} to avoid a downgrade."
  log_warn "If you intentionally want to downgrade, edit DUNE_IMAGE_TAG in .env manually."
else
  set_env_value DUNE_IMAGE_TAG "$discovered_tag"
  load_env_file
  log_success "Updated DUNE_IMAGE_TAG in .env to ${discovered_tag}."
fi