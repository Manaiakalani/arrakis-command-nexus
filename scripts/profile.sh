#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

show_profiles() {
  local current_profile fls_env env_label

  current_profile="$(strip_wrapping_quotes "${DEPLOYMENT_PROFILE:-basic}")"
  fls_env="$(strip_wrapping_quotes "${DUNE_FLS_ENV:-retail}")"
  env_label='Live'
  [[ "$fls_env" == 'beta' ]] && env_label='PTC'

  printf 'Available deployment profiles:\n\n'
  printf '  basic         - Survival + Overmap (~20 GB RAM)\n'
  printf '  standard-lean - + Deep Desert + social hubs, no story shards (~30 GB RAM)\n'
  printf '  standard      - + Deep Desert + Story (~30-40 GB RAM)\n'
  printf '  full          - All maps (~40+ GB RAM)\n\n'
  printf 'Current profile: %s\n' "$current_profile"
  printf 'Environment: %s (%s)\n' "$env_label" "$fls_env"
}

switch_profile() {
  local profile="${1:-}"

  if [[ -z "$profile" ]]; then
    printf 'Usage: %s switch <basic|standard-lean|standard|full>\n' "$0"
    return 1
  fi

  case "$profile" in
    basic|standard-lean|standard|full)
      set_env_value DEPLOYMENT_PROFILE "$profile"
      set_env_value COMPOSE_FILE "docker-compose.yml:docker-compose.${profile}.yml"
      export DEPLOYMENT_PROFILE="$profile"
      printf 'Switched to profile: %s\n' "$profile"
      printf "Run './dune restart' to apply.\n"
      ;;
    *)
      printf 'Unknown profile: %s\n' "$profile"
      printf 'Valid profiles: basic, standard-lean, standard, full\n'
      return 1
      ;;
  esac
}

switch_environment() {
  local env_name="${1:-}"

  case "$env_name" in
    live|retail)
      set_env_value DUNE_FLS_ENV 'retail'
      set_env_value STEAM_APP_ID '4754530'
      export DUNE_FLS_ENV='retail'
      export STEAM_APP_ID='4754530'
      printf 'Switched to Live environment.\n'
      ;;
    ptc|beta)
      set_env_value DUNE_FLS_ENV 'beta'
      set_env_value STEAM_APP_ID '3104830'
      export DUNE_FLS_ENV='beta'
      export STEAM_APP_ID='3104830'
      printf 'Switched to PTC (Public Test) environment.\n'
      ;;
    *)
      printf 'Usage: %s env <live|ptc>\n' "$0"
      return 1
      ;;
  esac

  printf "Run './dune restart' to apply.\n"
}

case "${1:-list}" in
  list|show)
    show_profiles
    ;;
  switch)
    switch_profile "${2:-}"
    ;;
  env)
    switch_environment "${2:-}"
    ;;
  *)
    printf 'Usage: %s {list|switch|env}\n' "$0"
    exit 1
    ;;
esac
