#!/usr/bin/env bash
# Seed a LAN neighbor entry to improve gateway access when hairpin NAT is missing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

print_banner
require_command docker
require_command ip

gateway_service="$(compose_services | grep -E 'gateway' | head -n1 || true)"
[[ -n "$gateway_service" ]] || die 'No gateway service was found in the compose configuration.'

run_compose up -d "$gateway_service" >/dev/null
container_id="$(run_compose ps -q "$gateway_service")"
[[ -n "$container_id" ]] || die 'Failed to resolve the gateway container ID.'

network_name="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$container_id" | head -n1 | tr -d '\r')"
bridge_gateway_ip="$(docker network inspect "$network_name" --format '{{(index .IPAM.Config 0).Gateway}}')"
lan_iface="$(ip route show default | awk '/default/ { print $5; exit }')"
host_mac="$(cat "/sys/class/net/${lan_iface}/address")"

[[ -n "$network_name" && -n "$bridge_gateway_ip" && -n "$lan_iface" ]] || die 'Unable to determine the Docker network gateway or LAN interface.'

log_info "Gateway service:    $gateway_service"
log_info "Docker network:     $network_name"
log_info "Bridge gateway IP:  $bridge_gateway_ip"
log_info "LAN interface:      $lan_iface"
log_info "Host MAC address:   $host_mac"

if [[ $EUID -eq 0 ]]; then
  log_step 'Seeding a permanent neighbor entry.'
  ip neigh replace "$bridge_gateway_ip" lladdr "$host_mac" nud permanent dev "$lan_iface"
else
  log_warn 'Root privileges are required to seed the neighbor entry.'
  printf 'Run the following command:\n  sudo ip neigh replace %s lladdr %s nud permanent dev %s\n' "$bridge_gateway_ip" "$host_mac" "$lan_iface"
fi

printf '\nCurrent neighbor entry (if present):\n'
ip neigh show "$bridge_gateway_ip" dev "$lan_iface" || true

cat <<EOF

If LAN clients still cannot loop back through the public address, check your router for:
  - NAT loopback / hairpin NAT support
  - Static NAT reflection rules for the Dune public ports
  - DNS override/split-horizon entries that point the public hostname to the LAN host
EOF