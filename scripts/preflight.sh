#!/usr/bin/env bash
# Quick pre-start validation for the Dune Awakening self-hosted stack.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

print_banner

failures=0
check() {
  local ok_message="$1"
  local fail_message="$2"
  local command_status="$3"

  if [[ "$command_status" == '0' ]]; then
    log_success "$ok_message"
  else
    log_error "$fail_message"
    ((failures+=1))
  fi
}

if [[ -f "$PROJECT_ROOT/.env" ]]; then
  check '.env file found.' '.env file is missing. Run dune init first.' '0'
else
  check '.env file found.' '.env file is missing. Run dune init first.' '1'
fi

if [[ -n "$(read_funcom_token || true)" ]]; then
  check 'Funcom token is present.' 'Funcom token is missing.' '0'
else
  check 'Funcom token is present.' 'Funcom token is missing.' '1'
fi

if have_command docker && docker images --format '{{.Repository}}:{{.Tag}}' | grep -Eq 'seabass-server|dune'; then
  check 'Docker images for the Dune server are loaded.' 'No Dune/Funcom server images were detected. Run scripts/load-images.sh first.' '0'
else
  check 'Docker images for the Dune server are loaded.' 'No Dune/Funcom server images were detected. Run scripts/load-images.sh first.' '1'
fi

if cpu_supports_avx2; then
  check 'CPU supports AVX2.' 'This host CPU does not expose AVX2 support.' '0'
else
  check 'CPU supports AVX2.' 'This host CPU does not expose AVX2 support.' '1'
fi

required_memory="$(profile_memory_mib "$DEPLOYMENT_PROFILE")"
if (( $(host_memory_mib) >= required_memory )); then
  check "RAM meets the ${required_memory} MiB requirement for profile $DEPLOYMENT_PROFILE." "RAM is below the ${required_memory} MiB requirement for profile $DEPLOYMENT_PROFILE." '0'
else
  check "RAM meets the ${required_memory} MiB requirement for profile $DEPLOYMENT_PROFILE." "RAM is below the ${required_memory} MiB requirement for profile $DEPLOYMENT_PROFILE." '1'
fi

port_failures=0
if have_command docker && docker_compose_ok && have_command python3 && [[ -f "$PROJECT_ROOT/docker-compose.yml" ]]; then
  mapfile -t required_ports < <(compose_expected_ports)
  mapfile -t current_ports < <(compose_running_ports)
  for port in "${required_ports[@]:-}"; do
    if port_in_use "$port" && ! printf '%s\n' "${current_ports[@]:-}" | grep -Fxq "$port"; then
      log_error "Required port $port is already in use by another process."
      ((port_failures+=1))
    fi
  done
fi
if ((port_failures == 0)); then
  log_success 'Required ports are available.'
else
  ((failures+=port_failures))
fi

if ((failures > 0)); then
  log_error "Preflight failed with $failures issue(s)."
  exit 1
fi

log_success 'Preflight checks passed.'