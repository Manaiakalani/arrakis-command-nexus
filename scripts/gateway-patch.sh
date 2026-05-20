#!/usr/bin/env bash
# Ensure the gateway container is running with the correct RMQ HTTP port flag.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

print_banner
require_command docker

gateway_service="$(compose_services | grep -E 'gateway' | head -n1 || true)"
[[ -n "$gateway_service" ]] || die 'No gateway service was found in the compose configuration.'

expected_port="$(strip_wrapping_quotes "${RMQ_GAME_HTTP_PORT:-${RABBITMQ_MANAGEMENT_PORT:-15672}}")"
[[ -n "$expected_port" ]] || die 'Set RMQ_GAME_HTTP_PORT (or RABBITMQ_MANAGEMENT_PORT) in .env before patching.'

log_step "Inspecting gateway service '$gateway_service'."
run_compose up -d "$gateway_service" >/dev/null
container_id="$(run_compose ps -q "$gateway_service")"
[[ -n "$container_id" ]] || die 'Failed to resolve the gateway container ID.'

cmdline="$(docker inspect --format '{{json .Config.Cmd}} {{json .Config.Entrypoint}}' "$container_id")"
if [[ "$cmdline" == *"--RMQGameHttpPort=$expected_port"* ]]; then
  log_success "Gateway already exposes --RMQGameHttpPort=$expected_port"
  exit 0
fi

log_warn 'Gateway command line is missing the expected RMQ HTTP flag. Recreating the service.'
run_compose up -d --force-recreate "$gateway_service"
container_id="$(run_compose ps -q "$gateway_service")"
cmdline="$(docker inspect --format '{{json .Config.Cmd}} {{json .Config.Entrypoint}}' "$container_id")"

if [[ "$cmdline" == *"--RMQGameHttpPort=$expected_port"* ]]; then
  log_success "Gateway patch verified: --RMQGameHttpPort=$expected_port"
else
  die 'Gateway recreation completed, but the expected RMQ HTTP flag is still missing.'
fi