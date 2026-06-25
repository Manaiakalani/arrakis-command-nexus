#!/usr/bin/env bash
# Common helpers for Dune Awakening self-hosted server scripts.
# shellcheck shell=bash

readonly DUNE_DEFAULT_VERSION="1.0.0"
readonly DUNE_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DUNE_REPO_HINT="$(cd "${DUNE_COMMON_DIR}/../.." && pwd)"

if [[ -t 1 ]]; then
  readonly COLOR_RED='\033[0;31m'
  readonly COLOR_GREEN='\033[0;32m'
  readonly COLOR_YELLOW='\033[0;33m'
  readonly COLOR_BLUE='\033[0;34m'
  readonly COLOR_MAGENTA='\033[0;35m'
  readonly COLOR_CYAN='\033[0;36m'
  readonly COLOR_BOLD='\033[1m'
  readonly COLOR_RESET='\033[0m'
else
  readonly COLOR_RED=''
  readonly COLOR_GREEN=''
  readonly COLOR_YELLOW=''
  readonly COLOR_BLUE=''
  readonly COLOR_MAGENTA=''
  readonly COLOR_CYAN=''
  readonly COLOR_BOLD=''
  readonly COLOR_RESET=''
fi

log_info() {
  printf '%b[INFO]%b %s\n' "$COLOR_CYAN" "$COLOR_RESET" "$*"
}

log_step() {
  printf '%b[STEP]%b %s\n' "$COLOR_BLUE" "$COLOR_RESET" "$*"
}

log_warn() {
  printf '%b[WARN]%b %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$*" >&2
}

log_success() {
  printf '%b[ OK ]%b %s\n' "$COLOR_GREEN" "$COLOR_RESET" "$*"
}

log_error() {
  printf '%b[FAIL]%b %s\n' "$COLOR_RED" "$COLOR_RESET" "$*" >&2
}

die() {
  log_error "$*"
  exit 1
}

have_command() {
  command -v "$1" >/dev/null 2>&1
}

require_command() {
  have_command "$1" || die "Required command not found: $1"
}

resolve_script_path() {
  local source_path="$1"
  local source_dir

  while [[ -L "$source_path" ]]; do
    source_dir="$(cd -P "$(dirname "$source_path")" && pwd)"
    source_path="$(readlink "$source_path")"
    [[ "$source_path" != /* ]] && source_path="${source_dir}/${source_path}"
  done

  printf '%s\n' "$(cd -P "$(dirname "$source_path")" && pwd)/$(basename "$source_path")"
}

find_project_root() {
  local hint_path="${1:-}"
  local -a search_roots=("$PWD" "$DUNE_REPO_HINT")
  local root
  local candidate

  if [[ -n "$hint_path" ]]; then
    search_roots+=("$(cd -P "$(dirname "$hint_path")" && pwd)")
  fi

  for root in "${search_roots[@]}"; do
    candidate="$root"
    while [[ "$candidate" != "/" ]]; do
      if [[ -f "$candidate/docker-compose.yml" ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
      candidate="$(dirname "$candidate")"
    done
  done

  if [[ -d "$DUNE_REPO_HINT/scripts" ]]; then
    printf '%s\n' "$DUNE_REPO_HINT"
    return 0
  fi

  return 1
}

load_env_file() {
  local env_file="$PROJECT_ROOT/.env"

  if [[ -f "$env_file" ]]; then
    # Don't `source` blindly — operators frequently leave display names and
    # similar settings as unquoted strings with spaces (e.g.
    # `OVERMAP_DISPLAY_NAME=Sietch Tabr`), which bash would interpret as
    # running `Tabr` as a command. Parse the file line-by-line and export
    # KEY=VALUE pairs ourselves, stripping any wrapping quotes.
    local line key value
    while IFS= read -r line || [[ -n "$line" ]]; do
      # Skip blanks and full-line comments.
      [[ -z "${line// }" ]] && continue
      [[ "${line#"${line%%[![:space:]]*}"}" =~ ^# ]] && continue
      # Strip a leading "export " prefix if present.
      line="${line#export }"
      # Require KEY=VALUE format; ignore anything else.
      [[ "$line" != *"="* ]] && continue
      key="${line%%=*}"
      value="${line#*=}"
      # Trim surrounding whitespace from the key.
      key="${key#"${key%%[![:space:]]*}"}"
      key="${key%"${key##*[![:space:]]}"}"
      # Skip lines whose key isn't a valid identifier (e.g. lines with ":" or
      # other YAML-ish content that operators sometimes paste in).
      [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
      # Strip a single layer of matching wrapping quotes.
      if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then
        value="${value:1:${#value}-2}"
      fi
      # Preserve runtime-resolved addresses so .env "auto" doesn't overwrite them.
      if [[ -n "${__DUNE_ADDR_RESOLVED:-}" ]] \
         && [[ "$key" == "EXTERNAL_ADDRESS" || "$key" == "GAME_RMQ_PUBLIC_HOST" ]] \
         && [[ -n "${!key+x}" ]]; then
        continue
      fi
      export "$key=$value"
    done < "$env_file"
  fi

  export DEPLOYMENT_PROFILE="${DEPLOYMENT_PROFILE:-basic}"
}

init_dune_env() {
  local entrypoint="${1:-${BASH_SOURCE[0]}}"
  entrypoint="$(resolve_script_path "$entrypoint")"

  if [[ -z "${PROJECT_ROOT:-}" ]]; then
    PROJECT_ROOT="$(find_project_root "$entrypoint")" || die 'Unable to locate the project root.'
  fi

  export PROJECT_ROOT
  export BACKUP_DIR="$PROJECT_ROOT/backups"
  export CONFIG_DIR="$PROJECT_ROOT/config"
  export SECRET_DIR="$PROJECT_ROOT/secrets"
  load_env_file
}

print_banner() {
  printf '%bDune Awakening Self-Hosted Server%b v%s\n' "$COLOR_BOLD$COLOR_MAGENTA" "$COLOR_RESET" "$(version_string)"
}

version_string() {
  if [[ -f "$PROJECT_ROOT/VERSION" ]]; then
    tr -d '\r\n' < "$PROJECT_ROOT/VERSION"
  else
    printf '%s' "$DUNE_DEFAULT_VERSION"
  fi
}

ensure_directory() {
  mkdir -p "$1"
}

escape_env_value() {
  local value="$1"
  value="$(printf '%s' "$value" | sed "s/'/'\\\\''/g")"
  printf "'%s'" "$value"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local env_file="${3:-$PROJECT_ROOT/.env}"
  local tmp_file="${env_file}.tmp.$$"
  local quoted

  quoted="$(escape_env_value "$value")"
  ensure_directory "$(dirname "$env_file")"

  if [[ -f "$env_file" ]]; then
    awk -v key="$key" -v value="$quoted" '
      BEGIN { updated = 0 }
      $0 ~ "^[[:space:]]*" key "=" {
        print key "=" value
        updated = 1
        next
      }
      { print }
      END {
        if (!updated) {
          print key "=" value
        }
      }
    ' "$env_file" > "$tmp_file"
  else
    printf '%s=%s\n' "$key" "$quoted" > "$tmp_file"
  fi

  mv "$tmp_file" "$env_file"
}

strip_wrapping_quotes() {
  local value="$1"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s\n' "$value"
}

read_funcom_token() {
  if [[ -s "$SECRET_DIR/funcom-token.txt" ]]; then
    tr -d '\r\n' < "$SECRET_DIR/funcom-token.txt"
  elif [[ -n "${FLS_SECRET:-}" ]]; then
    printf '%s' "$FLS_SECRET"
  fi
}

write_secret_file() {
  local file_path="$1"
  local secret_value="$2"

  ensure_directory "$(dirname "$file_path")"
  umask 077
  printf '%s\n' "$secret_value" > "$file_path"
  chmod 600 "$file_path" 2>/dev/null || true
}

random_password() {
  if have_command openssl; then
    openssl rand -base64 24 | tr -d '\n'
  else
    head -c 24 /dev/urandom | base64 | tr -d '\n'
  fi
}

random_token() {
  local bytes="${1:-32}"

  if have_command openssl; then
    openssl rand -hex "$bytes"
  else
    head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

confirm() {
  local prompt="$1"
  local default_answer="${2:-N}"
  local reply=''

  if [[ "$default_answer" =~ ^[Yy]$ ]]; then
    read -r -p "$prompt [Y/n] " reply
    [[ -z "$reply" || "$reply" =~ ^[Yy]$ ]]
  else
    read -r -p "$prompt [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]]
  fi
}

prompt_input() {
  local prompt="$1"
  local default_value="${2:-}"
  local reply=''

  if [[ -n "$default_value" ]]; then
    read -r -p "$prompt [$default_value]: " reply
    printf '%s\n' "${reply:-$default_value}"
  else
    read -r -p "$prompt: " reply
    printf '%s\n' "$reply"
  fi
}

prompt_secret() {
  local prompt="$1"
  local reply=''

  read -r -s -p "$prompt: " reply
  printf '\n' >&2
  printf '%s\n' "$reply"
}

profile_memory_mib() {
  case "$1" in
    basic) printf '8192\n' ;;
    standard) printf '16384\n' ;;
    full) printf '32768\n' ;;
    *) printf '8192\n' ;;
  esac
}

profile_memory_label() {
  case "$1" in
    basic) printf '8 GiB minimum\n' ;;
    standard) printf '16 GiB minimum\n' ;;
    full) printf '32 GiB minimum\n' ;;
    *) printf '8 GiB minimum\n' ;;
  esac
}

host_memory_mib() {
  awk '/MemTotal:/ { print int($2 / 1024) }' /proc/meminfo
}

available_memory_mib() {
  awk '/MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo
}

cpu_supports_avx2() {
  grep -qi 'avx2' /proc/cpuinfo
}

docker_daemon_ok() {
  docker info >/dev/null 2>&1
}

docker_compose_ok() {
  docker compose version >/dev/null 2>&1
}

compose_file_paths() {
  local core_file="$PROJECT_ROOT/docker-compose.yml"
  local profile_file="$PROJECT_ROOT/docker-compose.${DEPLOYMENT_PROFILE}.yml"
  local dashboard_file="$PROJECT_ROOT/docker-compose.dashboard.yml"
  local hostnet_file="${DUNE_HOSTNET_OVERLAY:-}"

  [[ -f "$core_file" ]] || return 1
  printf '%s\n' "$core_file"
  [[ -f "$profile_file" ]] && printf '%s\n' "$profile_file"
  if [[ -n "$hostnet_file" ]]; then
    local hostnet_path="$PROJECT_ROOT/$hostnet_file"
    [[ -f "$hostnet_path" ]] && printf '%s\n' "$hostnet_path"
  fi
  [[ -f "$dashboard_file" ]] && printf '%s\n' "$dashboard_file"
}

require_compose_stack() {
  require_command docker
  docker_compose_ok || die 'docker compose is not available.'
  [[ -f "$PROJECT_ROOT/docker-compose.yml" ]] || die "docker-compose.yml was not found under $PROJECT_ROOT"
}

run_compose() {
  local -a command=(docker compose)
  local compose_file

  require_compose_stack
  while IFS= read -r compose_file; do
    command+=(-f "$compose_file")
  done < <(compose_file_paths)

  "${command[@]}" "$@"
}

compose_services() {
  run_compose config --services
}

service_exists() {
  local service_name="$1"
  compose_services | grep -Fxq "$service_name"
}

compose_config_json() {
  run_compose config --format json
}

compose_expected_ports() {
  if ! have_command python3; then
    return 0
  fi

  compose_config_json | python3 -c 'import json, sys
config = json.load(sys.stdin)
seen = set()
for svc in config.get("services", {}).values():
    for port in svc.get("ports", []) or []:
        published = None
        if isinstance(port, dict):
            published = port.get("published")
        elif isinstance(port, str):
            published = port.split(":", 1)[0].split("/")[0]
        if published is None:
            continue
        published = str(published)
        if published and published not in seen:
            seen.add(published)
            print(published)
'
}

compose_running_ports() {
  if ! have_command python3; then
    return 0
  fi

  run_compose ps --format json 2>/dev/null | python3 -c 'import json, sys
raw = sys.stdin.read().strip()
if not raw:
    raise SystemExit(0)
# `docker compose ps --format json` emits either a JSON array (older Compose)
# or newline-delimited JSON objects (newer Compose). Handle both.
try:
    items = json.loads(raw)
    if isinstance(items, dict):
        items = [items]
except json.JSONDecodeError:
    items = [json.loads(line) for line in raw.splitlines() if line.strip()]
seen = set()
for item in items:
    if not isinstance(item, dict):
        continue
    for publisher in item.get("Publishers") or []:
        if not isinstance(publisher, dict):
            continue
        port = publisher.get("PublishedPort")
        if port is None:
            continue
        port = str(port)
        if port not in seen:
            seen.add(port)
            print(port)
'
}

dashboard_url() {
  # The dashboard frontend is published on the host at
  # DUNE_ADMIN_BIND_ADDRESS:DUNE_ADMIN_HOST_PORT (see docker-compose.yml), which
  # maps to the container's internal port 3000. Derive the browsable URL from
  # those so `dune init` and `dune dashboard` never point at the wrong port.
  # DASHBOARD_HOST / DASHBOARD_PORT remain honored as explicit overrides.
  local host port
  port="${DASHBOARD_PORT:-${DUNE_ADMIN_HOST_PORT:-18080}}"
  host="${DASHBOARD_HOST:-${DUNE_ADMIN_BIND_ADDRESS:-127.0.0.1}}"
  # An all-interfaces bind (0.0.0.0 / ::) is not a usable URL host; show localhost.
  if [[ -z "$host" || "$host" == "0.0.0.0" || "$host" == "::" ]]; then
    host="localhost"
  elif [[ "$host" == *:* && "$host" != \[*\] ]]; then
    # Bracket IPv6 literals (e.g. ::1) so the URL stays valid: http://[::1]:18080
    host="[$host]"
  fi
  printf 'http://%s:%s\n' "$host" "$port"
}

human_size() {
  du -sh "$1" | awk '{ print $1 }'
}

is_infra_service() {
  case "$1" in
    postgres|rabbitmq|db-init|dashboard|dashboard-backend|dashboard-frontend|frontend|backend|api|adminer)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

game_services() {
  local service_name
  while IFS= read -r service_name; do
    [[ -n "$service_name" ]] || continue
    if ! is_infra_service "$service_name"; then
      printf '%s\n' "$service_name"
    fi
  done < <(compose_services)
}

port_in_use() {
  local port="$1"
  ss -H -ltnu 2>/dev/null | awk '{ print $5 }' | grep -Eq "(^|:)$port$"
}

try_open_browser() {
  # Best-effort: open $url in a browser if a launcher is available. Returns
  # non-zero (without dying) on headless hosts so callers can fall back to
  # simply printing the URL. Supports Linux (xdg-open) and macOS (open).
  local url="$1"
  local opener
  for opener in xdg-open open; do
    if have_command "$opener"; then
      "$opener" "$url" >/dev/null 2>&1 &
      return 0
    fi
  done
  return 1
}