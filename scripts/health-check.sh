#!/usr/bin/env bash
# Diagnostic checks for the Dune Awakening self-hosted server stack.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

print_banner

require_command awk
require_command df
require_command ss

declare -a STATUSES=()
declare -a TITLES=()
declare -a DETAILS=()
declare -a FIXES=()

add_result() {
  STATUSES+=("$1")
  TITLES+=("$2")
  DETAILS+=("$3")
  FIXES+=("$4")
}

print_results() {
  local index symbol color
  local failures=0

  printf '\nDiagnostic results:\n'
  for index in "${!STATUSES[@]}"; do
    case "${STATUSES[$index]}" in
      pass) symbol='✓'; color="$COLOR_GREEN" ;;
      warn) symbol='!'; color="$COLOR_YELLOW" ;;
      *) symbol='✗'; color="$COLOR_RED"; ((failures+=1)) ;;
    esac

    printf '  %b%s%b %s - %s\n' "$color" "$symbol" "$COLOR_RESET" "${TITLES[$index]}" "${DETAILS[$index]}"
    if [[ "${STATUSES[$index]}" != 'pass' && -n "${FIXES[$index]}" ]]; then
      printf '      Fix: %s\n' "${FIXES[$index]}"
    fi
  done

  return "$failures"
}

if have_command docker && docker_daemon_ok; then
  add_result pass 'Docker daemon' 'Docker is running.' ''
else
  add_result fail 'Docker daemon' 'Docker does not appear to be running.' 'Start the Docker service and rerun dune doctor.'
fi

if have_command docker && docker_compose_ok && [[ -f "$PROJECT_ROOT/docker-compose.yml" ]]; then
  mapfile -t expected_services < <(compose_services)
  mapfile -t running_services < <(run_compose ps --services --status running 2>/dev/null || true)
  missing_services=()
  for service_name in "${expected_services[@]}"; do
    if ! printf '%s\n' "${running_services[@]:-}" | grep -Fxq "$service_name"; then
      missing_services+=("$service_name")
    fi
  done

  if ((${#missing_services[@]} == 0)); then
    add_result pass 'Expected containers' "All ${#expected_services[@]} expected containers are running." ''
  else
    add_result fail 'Expected containers' "Missing or stopped services: ${missing_services[*]}" 'Run dune start and inspect dune logs for the failing service.'
  fi
else
  add_result warn 'Expected containers' 'Compose stack is not ready for inspection.' 'Ensure docker-compose.yml exists and Docker Compose is installed.'
fi

if have_command docker && service_exists postgres 2>/dev/null; then
  if run_compose exec -T postgres pg_isready -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-dune_sb_1_4_0_0}" >/dev/null 2>&1; then
    add_result pass 'Postgres' 'Database is accepting connections.' ''
  else
    add_result fail 'Postgres' 'Database is not accepting connections yet.' 'Check postgres logs and verify credentials in .env.'
  fi
else
  add_result warn 'Postgres' 'Postgres service is not defined in the compose stack.' ''
fi

if have_command docker && service_exists rabbitmq 2>/dev/null; then
  rabbitmq_port="$(strip_wrapping_quotes "${RABBITMQ_MANAGEMENT_PORT:-15672}")"
  rabbitmq_user="$(strip_wrapping_quotes "${RABBITMQ_DEFAULT_USER:-guest}")"
  rabbitmq_pass="$(strip_wrapping_quotes "${RABBITMQ_DEFAULT_PASS:-guest}")"
  if have_command curl && curl -fsS -u "$rabbitmq_user:$rabbitmq_pass" "http://127.0.0.1:${rabbitmq_port}/api/overview" >/dev/null 2>&1; then
    add_result pass 'RabbitMQ' 'Management API responded successfully.' ''
  elif run_compose exec -T rabbitmq rabbitmq-diagnostics -q ping >/dev/null 2>&1; then
    add_result warn 'RabbitMQ' 'Broker is alive, but the management API was not reachable on the host.' 'Verify the management port mapping and credentials in .env.'
  else
    add_result fail 'RabbitMQ' 'Broker health checks failed.' 'Inspect the rabbitmq container logs and credentials.'
  fi
else
  add_result warn 'RabbitMQ' 'RabbitMQ service is not defined in the compose stack.' ''
fi

if have_command docker && [[ -f "$PROJECT_ROOT/docker-compose.yml" ]]; then
  ready_services=()
  unready_services=()
  while IFS= read -r service_name; do
    [[ -n "$service_name" ]] || continue
    if run_compose logs --no-color --tail=200 "$service_name" 2>/dev/null | grep -Eiq 'ready|listening|startup complete|accepting connections'; then
      ready_services+=("$service_name")
    else
      unready_services+=("$service_name")
    fi
  done < <(game_services)

  if ((${#ready_services[@]} == 0)) && ((${#unready_services[@]} == 0)); then
    add_result warn 'Game servers' 'No game services were detected in the compose profile.' ''
  elif ((${#unready_services[@]} == 0)); then
    add_result pass 'Game servers' "Ready indicators found for: ${ready_services[*]}" ''
  else
    add_result warn 'Game servers' "No ready indicator found yet for: ${unready_services[*]}" 'Wait a little longer, then check dune logs <service>.'
  fi
fi

required_ports=()
if have_command docker && docker_compose_ok && have_command python3; then
  while IFS= read -r port; do
    [[ -n "$port" ]] && required_ports+=("$port")
  done < <(compose_running_ports)
fi
if ((${#required_ports[@]} > 0)); then
  closed_ports=()
  for port in "${required_ports[@]}"; do
    if ! port_in_use "$port"; then
      closed_ports+=("$port")
    fi
  done
  if ((${#closed_ports[@]} == 0)); then
    add_result pass 'Network ports' "Published ports are listening: ${required_ports[*]}" ''
  else
    add_result fail 'Network ports' "Expected ports are not listening: ${closed_ports[*]}" 'Run dune status and verify the relevant services are up.'
  fi
else
  add_result warn 'Network ports' 'No published ports were detected for running services.' ''
fi

free_disk_kib="$(df -Pk "$PROJECT_ROOT" | awk 'NR==2 { print $4 }')"
min_disk_kib="$((10 * 1024 * 1024))"
if ((free_disk_kib >= min_disk_kib)); then
  add_result pass 'Disk space' "$(df -h "$PROJECT_ROOT" | awk 'NR==2 { print $4 " free" }')" ''
else
  add_result fail 'Disk space' "Only $(df -h "$PROJECT_ROOT" | awk 'NR==2 { print $4 " free" }') remains." 'Free up at least 10 GiB before running the server.'
fi

total_memory="$(host_memory_mib)"
available_memory="$(available_memory_mib)"
required_memory="$(profile_memory_mib "$DEPLOYMENT_PROFILE")"
if ((total_memory < required_memory)); then
  add_result fail 'Memory capacity' "Host RAM ${total_memory} MiB is below the ${required_memory} MiB requirement for profile $DEPLOYMENT_PROFILE." 'Choose a smaller profile or move the stack to a larger host.'
elif ((available_memory < required_memory / 2)); then
  add_result warn 'Memory headroom' "Only ${available_memory} MiB is currently available." 'Stop other workloads before starting all Dune services.'
else
  add_result pass 'Memory' "${available_memory} MiB available / ${total_memory} MiB total." ''
fi

if cpu_supports_avx2; then
  add_result pass 'CPU AVX2' 'AVX2 support detected.' ''
else
  add_result fail 'CPU AVX2' 'AVX2 support was not detected on this host.' 'Use hardware that exposes AVX2 to the Linux kernel.'
fi

if [[ -n "$(read_funcom_token || true)" ]]; then
  add_result pass 'Funcom token' 'Token file or FLS_SECRET is present.' ''
else
  add_result fail 'Funcom token' 'No Funcom token was found.' 'Run dune init or place the token in secrets/funcom-token.txt.'
fi

print_results
exit $?