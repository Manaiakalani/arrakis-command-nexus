#!/usr/bin/env bash
# First-time setup wizard for the Dune Awakening self-hosted stack.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

write_default_env_template() {
  cat > "$PROJECT_ROOT/.env" <<'EOF'
DEPLOYMENT_PROFILE=basic
SERVER_NAME='Dune Awakening Server'
PUBLIC_IP=''
DUNE_STEAM_SERVER_DIR=''
DUNE_IMAGE_TAG='latest'
POSTGRES_DB='dune'
POSTGRES_USER='postgres'
POSTGRES_PASSWORD='change-me'
RABBITMQ_DEFAULT_USER='dune'
RABBITMQ_DEFAULT_PASS='change-me'
DASHBOARD_HOST='localhost'
DASHBOARD_PORT='3000'
DASHBOARD_ADMIN_TOKEN=''
STEAM_APP_ID=''
EOF
}

select_profile() {
  local selection=''
  printf 'Select deployment profile:\n'
  printf '  1) basic    - %s\n' "$(profile_memory_label basic)"
  printf '  2) standard - %s\n' "$(profile_memory_label standard)"
  printf '  3) full     - %s\n' "$(profile_memory_label full)"

  while :; do
    read -r -p 'Profile [1-3]: ' selection
    case "$selection" in
      1) printf 'basic\n'; return 0 ;;
      2) printf 'standard\n'; return 0 ;;
      3) printf 'full\n'; return 0 ;;
      *) log_warn 'Please choose 1, 2, or 3.' ;;
    esac
  done
}

ensure_env_file() {
  if [[ -f "$PROJECT_ROOT/.env" ]]; then
    log_info 'Using existing .env file.'
    return 0
  fi

  if [[ -f "$PROJECT_ROOT/.env.example" ]]; then
    cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
    log_success 'Copied .env.example to .env.'
  else
    write_default_env_template
    log_warn '.env.example was missing; generated a minimal .env template instead.'
  fi

  load_env_file
}

print_banner
log_step 'Checking prerequisites.'
require_command docker
require_command curl
require_command awk
docker_compose_ok || die 'docker compose is required.'
cpu_supports_avx2 || die 'AVX2 CPU support is required for the Dune dedicated server.'
docker_daemon_ok || die 'Docker daemon is not running. Start Docker and re-run setup.'
log_success 'Docker, compose, and AVX2 checks passed.'

ensure_directory "$SECRET_DIR"
ensure_directory "$CONFIG_DIR"
ensure_directory "$BACKUP_DIR"
ensure_env_file

existing_token="$(read_funcom_token || true)"
if [[ -n "$existing_token" ]] && ! confirm 'A Funcom token already exists. Replace it?' 'N'; then
  funcom_token="$existing_token"
else
  while :; do
    funcom_token="$(prompt_secret 'Enter your Funcom token')"
    [[ -n "$funcom_token" ]] && break
    log_warn 'The Funcom token cannot be empty.'
  done
  write_secret_file "$SECRET_DIR/funcom-token.txt" "$funcom_token"
  log_success 'Saved Funcom token to secrets/funcom-token.txt.'
fi

server_name_default="$(strip_wrapping_quotes "${SERVER_NAME:-Dune Awakening Server}")"
server_name="$(prompt_input 'Server name' "$server_name_default")"
set_env_value SERVER_NAME "$server_name"

detected_ip=''
if detected_ip="$(curl -fsS api.ipify.org 2>/dev/null)"; then
  log_info "Detected public IP: $detected_ip"
fi
public_ip_default="$(strip_wrapping_quotes "${PUBLIC_IP:-$detected_ip}")"
public_ip="$(prompt_input 'Public IP (leave blank to use the detected value)' "$public_ip_default")"
set_env_value PUBLIC_IP "$public_ip"

profile="$(select_profile)"
set_env_value DEPLOYMENT_PROFILE "$profile"
export DEPLOYMENT_PROFILE="$profile"

postgres_password="$(strip_wrapping_quotes "${POSTGRES_PASSWORD:-}")"
if [[ -z "$postgres_password" || "$postgres_password" == 'change-me' ]]; then
  postgres_password="$(random_password)"
  set_env_value POSTGRES_PASSWORD "$postgres_password"
  log_success 'Generated a secure Postgres password.'
fi

rabbitmq_password="$(strip_wrapping_quotes "${RABBITMQ_DEFAULT_PASS:-}")"
if [[ -z "$rabbitmq_password" || "$rabbitmq_password" == 'change-me' ]]; then
  rabbitmq_password="$(random_password)"
  set_env_value RABBITMQ_DEFAULT_PASS "$rabbitmq_password"
  log_success 'Generated a secure RabbitMQ password.'
fi

dashboard_token="$(strip_wrapping_quotes "${DASHBOARD_ADMIN_TOKEN:-}")"
if [[ -z "$dashboard_token" || "$dashboard_token" == 'change-me' ]]; then
  dashboard_token="$(random_token 24)"
  set_env_value DASHBOARD_ADMIN_TOKEN "$dashboard_token"
  log_success 'Generated a dashboard admin token.'
fi

log_step 'Loading Funcom Docker images from the Steam server package.'
"$PROJECT_ROOT/scripts/load-images.sh"
load_env_file

if service_exists postgres; then
  log_step 'Starting database dependencies.'
  run_compose up -d postgres >/dev/null
fi
if service_exists rabbitmq; then
  run_compose up -d rabbitmq >/dev/null
fi
if service_exists db-init; then
  log_step 'Initializing the database.'
  run_compose run --rm db-init
  log_success 'Database initialization completed.'
else
  log_warn 'db-init service is not defined in the compose stack; skipping database initialization.'
fi

cat <<EOF

Setup complete.

Project root:        $PROJECT_ROOT
Deployment profile:  $profile ($(profile_memory_label "$profile"))
Server name:         $server_name
Public IP:           ${public_ip:-<not set>}
Image tag:           $(strip_wrapping_quotes "${DUNE_IMAGE_TAG:-unknown}")
Dashboard URL:       $(dashboard_url)

Next steps:
  1. Review .env and config/ for any final changes.
  2. Start the stack with: dune start
  3. Run diagnostics with: dune doctor
EOF