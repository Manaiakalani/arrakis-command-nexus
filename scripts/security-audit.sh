#!/usr/bin/env bash
# Security audit checks for the Dune Awakening self-hosted stack.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

pass_count=0
warn_count=0
fail_count=0

pass() {
  printf '✅ %s\n' "$1"
  ((pass_count+=1))
}

warn() {
  printf '⚠️  %s\n' "$1"
  ((warn_count+=1))
}

fail() {
  printf '❌ %s\n' "$1"
  ((fail_count+=1))
}

search_leaks() {
  local -a excludes=(
    --exclude-dir=.git
    --exclude-dir=node_modules
    --exclude-dir=.next
    --exclude-dir=backups
    --exclude-dir=data
    --exclude-dir=steam
    --exclude-dir=secrets
    --exclude=.env
    --exclude=.env.example
    --exclude=package-lock.json
    # Exclude scripts/docs that intentionally show placeholder values
    --exclude=setup.sh
    --exclude=smoke-test.sh
    --exclude='*.md'
  )
  local -a patterns=(
    'FLS_SECRET\s*=\s*[^${\s].+$'
    # Exclude placeholder tokens (change-me*, xxx, <...>)
    'DUNE_ADMIN_TOKEN\s*=\s*(?!change-me|xxx|<)[^\s${"'"'"'<].{8,}'
    'DISCORD_WEBHOOK_URL\s*=\s*https://discord\.com/api/webhooks/'
    'gh[pousr]_[A-Za-z0-9_]{36,}'
    'github_pat_[A-Za-z0-9_]+'
    'AKIA[0-9A-Z]{16}'
    '-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----'
    'Bearer [A-Za-z0-9._-]{30,}'
  )
  local matches=''
  local pattern

  for pattern in "${patterns[@]}"; do
    if matches="$(grep -RInP "${excludes[@]}" "$pattern" "$PROJECT_ROOT" 2>/dev/null)" && [[ -n "$matches" ]]; then
      printf '%s\n' "$matches"
      return 0
    fi
  done

  return 1
}

check_env_not_committed() {
  if git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if git -C "$PROJECT_ROOT" ls-files --error-unmatch .env >/dev/null 2>&1; then
      fail '.env is tracked by git. Remove it from version control and rotate secrets.'
    else
      pass '.env is not tracked by git.'
    fi
  else
    warn 'Git metadata not available; could not verify whether .env is committed.'
  fi
}

check_dashboard_binding() {
  local bind_address="${DUNE_ADMIN_BIND_ADDRESS:-127.0.0.1}"

  if [[ "$bind_address" == '127.0.0.1' || "$bind_address" == 'localhost' ]]; then
    pass "Dashboard bind address is local-only ($bind_address)."
  elif [[ "$bind_address" == '0.0.0.0' ]]; then
    warn "Dashboard is bound to all interfaces ($bind_address). Ensure it is behind a firewall or trusted reverse proxy."
  else
    fail "Dashboard bind address is $bind_address. Prefer 127.0.0.1 unless protected by a trusted reverse proxy/firewall."
  fi
}

check_compose_exposure() {
  local compose_file="$PROJECT_ROOT/docker-compose.yml"

  if [[ ! -f "$compose_file" ]]; then
    fail 'docker-compose.yml is missing.'
    return
  fi

  # PostgreSQL — accepts default syntax: 127.0.0.1:${VAR:-PORT}:5432
  if grep -Eq '127\.0\.0\.1:\$\{POSTGRES_PORT(:-[0-9]+)?\}:5432' "$compose_file"; then
    pass 'PostgreSQL is bound to localhost.'
  else
    fail 'PostgreSQL does not appear to be bound to localhost.'
  fi

  # RabbitMQ — check that the internal admin-rmq management UI is NOT on 0.0.0.0.
  # Note: game-rmq ports (31982/31983) are intentionally public; Funcom FLS requires them.
  local rmq_ok=true
  # admin-rmq management (15672) must be localhost only
  if ! grep -qE '127\.0\.0\.1:[0-9]+:15672' "$compose_file"; then
    rmq_ok=false
  fi
  # admin-rmq AMQP (5672) must be localhost only
  if ! grep -qE '127\.0\.0\.1:[0-9]+:5672' "$compose_file"; then
    rmq_ok=false
  fi
  if "$rmq_ok"; then
    pass 'RabbitMQ admin and management ports are local-only.'
  else
    fail 'RabbitMQ admin or management ports may be exposed publicly.'
  fi
}

check_docker_socket_permissions() {
  local socket='/var/run/docker.sock'

  if [[ ! -S "$socket" ]]; then
    warn 'Docker socket not found; skipping socket permission check.'
    return
  fi

  local mode owner_group
  mode="$(stat -c '%a' "$socket")"
  owner_group="$(stat -c '%U:%G' "$socket")"

  if [[ "$mode" =~ [2367]$ ]]; then
    fail "Docker socket is world-accessible ($mode, $owner_group). Restrict it to root/docker only."
  else
    pass "Docker socket permissions look restricted ($mode, $owner_group)."
  fi
}

print_banner

if leak_output="$(search_leaks)"; then
  fail 'Potential secret material found in tracked source paths:'
  printf '%s\n' "$leak_output"
else
  pass 'No obvious leaked tokens found in source files.'
fi

check_env_not_committed
check_dashboard_binding
check_compose_exposure
check_docker_socket_permissions

printf '\nSummary: %s passed, %s warnings, %s failed\n' "$pass_count" "$warn_count" "$fail_count"

if ((fail_count > 0)); then
  exit 1
fi
