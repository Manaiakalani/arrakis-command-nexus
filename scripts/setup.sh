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
WORLD_NAME='Dune Awakening Server'
WORLD_UNIQUE_NAME='sh-my-dune-server'
EXTERNAL_ADDRESS='auto'
DUNE_IMAGE_TAG='latest' # Pin to a specific tag after first setup
POSTGRES_SUPER_PASSWORD='change-me-postgres-super'
POSTGRES_DUNE_PASSWORD='change-me-dune-db'
DUNE_RMQ_MANAGEMENT_USER='dune-admin'
DUNE_RMQ_MANAGEMENT_PASSWORD='change-me-rmq-management-password'
RMQ_HTTP_TOKEN_AUTH_SECRET='change-me-rmq-http-token'
DUNE_ADMIN_BIND_ADDRESS='127.0.0.1'
DUNE_ADMIN_HOST_PORT='18080'
DUNE_ADMIN_TOKEN='change-me-admin-token'
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

server_name_default="$(strip_wrapping_quotes "${WORLD_NAME:-Dune Awakening Server}")"
server_name="$(prompt_input 'Server name' "$server_name_default")"
set_env_value WORLD_NAME "$server_name"

detected_ip=''
if detected_ip="$(curl -fsS api.ipify.org 2>/dev/null)"; then
  log_info "Detected public IP: $detected_ip"
fi
public_ip_default="$(strip_wrapping_quotes "${EXTERNAL_ADDRESS:-$detected_ip}")"
public_ip="$(prompt_input 'Public IP or domain (required for players to connect)' "$public_ip_default")"
if [[ -z "$public_ip" ]]; then
  log_warn 'EXTERNAL_ADDRESS is empty. Players will not be able to connect until you set it in .env.'
fi
set_env_value EXTERNAL_ADDRESS "$public_ip"

profile="$(select_profile)"
set_env_value DEPLOYMENT_PROFILE "$profile"
export DEPLOYMENT_PROFILE="$profile"

postgres_password="$(strip_wrapping_quotes "${POSTGRES_SUPER_PASSWORD:-}")"
if [[ -z "$postgres_password" || "$postgres_password" == 'change-me'* ]]; then
  postgres_password="$(random_password)"
  set_env_value POSTGRES_SUPER_PASSWORD "$postgres_password"
  log_success 'Generated a secure Postgres super password.'
fi

dune_db_password="$(strip_wrapping_quotes "${POSTGRES_DUNE_PASSWORD:-}")"
if [[ -z "$dune_db_password" || "$dune_db_password" == 'change-me'* ]]; then
  dune_db_password="$(random_password)"
  set_env_value POSTGRES_DUNE_PASSWORD "$dune_db_password"
  log_success 'Generated a secure Postgres dune password.'
fi

rabbitmq_password="$(strip_wrapping_quotes "${DUNE_RMQ_MANAGEMENT_PASSWORD:-}")"
if [[ -z "$rabbitmq_password" || "$rabbitmq_password" == 'change-me'* ]]; then
  rabbitmq_password="$(random_password)"
  set_env_value DUNE_RMQ_MANAGEMENT_PASSWORD "$rabbitmq_password"
  log_success 'Generated a secure RabbitMQ management password.'
fi

dashboard_token="$(strip_wrapping_quotes "${DUNE_ADMIN_TOKEN:-}")"
if [[ -z "$dashboard_token" || "$dashboard_token" == 'change-me'* ]]; then
  dashboard_token="$(random_token 24)"
  set_env_value DUNE_ADMIN_TOKEN "$dashboard_token"
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