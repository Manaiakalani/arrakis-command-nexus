#!/usr/bin/env bash
# =============================================================================
#  ___                      _                _              _
# |   \ _  _ _ _  ___      /_\__ __ ____ _| |_____ _ _ (_)_ _  __ _
# | |) | || | ' \/ -_)    / _ \ V  V / _` | / / -_) ' \| | ' \/ _` |
# |___/ \_,_|_||_\___|   /_/ \_\_/\_/\__,_|_\_\___|_||_|_|_||_\__, |
#                                                              |___/
#            A R R A K I S   C O M M A N D   N E X U S
#                   Interactive Deployment Wizard
# =============================================================================
#
# One-command deployment for the Dune Awakening self-hosted server.
# Guides you through everything: prerequisites, configuration,
# server sizing, region selection, and container deployment.
#
# Usage:
#   ./scripts/deploy.sh          Full interactive wizard
#   ./scripts/deploy.sh --quick  Skip confirmations (use defaults)
#   ./scripts/deploy.sh --help   Show usage
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
QUICK_MODE=false
DRY_RUN=false
WIZARD_STEP=0
WIZARD_TOTAL=8
DEPLOY_START_TIME="$(date +%s)"

for arg in "$@"; do
  case "$arg" in
    --quick|-q) QUICK_MODE=true ;;
    --dry-run)  DRY_RUN=true ;;
    --help|-h)
      cat <<'USAGE'
Usage: deploy.sh [OPTIONS]

Options:
  --quick, -q   Use defaults where possible, skip confirmations
  --dry-run     Validate everything but don't actually start containers
  --help, -h    Show this message

Environment:
  DUNE_NONINTERACTIVE=1   Run fully non-interactive (implies --quick)
USAGE
      exit 0
      ;;
  esac
done

[[ "${DUNE_NONINTERACTIVE:-}" == "1" ]] && QUICK_MODE=true

# ---------------------------------------------------------------------------
# Terminal capabilities
# ---------------------------------------------------------------------------
TERM_COLS="$(tput cols 2>/dev/null || printf '80')"
TERM_LINES="$(tput lines 2>/dev/null || printf '24')"

if [[ -t 1 ]]; then
  DIM='\033[2m'
  ITALIC='\033[3m'
  BLINK='\033[5m'
  AMBER='\033[38;5;214m'
  SAND='\033[38;5;180m'
  ORANGE='\033[38;5;208m'
  SPICE='\033[38;5;196m'
  WATER='\033[38;5;39m'
  SAGE='\033[38;5;108m'
  GREY='\033[38;5;240m'
  WHITE='\033[1;37m'
  RESET='\033[0m'
else
  DIM='' ITALIC='' BLINK=''
  AMBER='' SAND='' ORANGE='' SPICE='' WATER='' SAGE='' GREY='' WHITE='' RESET=''
fi

# ---------------------------------------------------------------------------
# ASCII Art
# ---------------------------------------------------------------------------
print_sandworm() {
  printf '%b' "$AMBER"
  cat <<'WORM'

                          .  .        .
                   .  _  .     .  .     .
                .  .' '.  .        .
             .  .'       '. .   .    .
          .  .'    ,;;;,    '.        .
        .  .'   ,;;'   ';;,   '.  .
      .  .'  ,;;' .SPICE. ';;,  '.   .
    . ..'  ,;;'  :::::::::  ';;,  '..
   ..'   ,;;'  ::::::::::::: ';;,   '..
  .    ,;;'  :::::::::::::::::  ';;,    .
 . .,;;'  :::::::::::::::::::::  ';;,. .
  ';;  :::::::::::::::::::::::::  ;;'
   ';;, ':::::::::::::::::::' ,;;'
     ';;,  ':::::::::::::::' ,;;'
       ';;,   '::::::::::' ,;;'
         ';;,    ''''''   ,;;'
           ';;,         ,;;'
             ';;,     ,;;'
               ';;, ,;;'
                 ';:;'

WORM
  printf '%b' "$RESET"
}

print_logo() {
  printf '%b' "$ORANGE"
  cat <<'LOGO'
  ______________________________________________________
 /                                                      \
|    ___                      _                _          |
|   |   \ _  _ _ _  ___     /_\__ __ ____ _| |___  _    |
|   | |) | || | ' \/ -_)   / _ \ V  V / _` | / / -_)    |
|   |___/ \_,_|_||_\___|  /_/ \_\_/\_/\__,_|_\_\___|    |
|                                                        |
LOGO
  printf '%b' "$AMBER"
  cat <<'LOGO2'
|          ARRAKIS COMMAND NEXUS                         |
|          Self-Hosted Server Deployment                 |
 \______________________________________________________/
LOGO2
  printf '%b' "$RESET"
}

print_separator() {
  local char="${1:--}"
  local width="${2:-$TERM_COLS}"
  [[ "$width" -gt 72 ]] && width=72
  printf '%b' "$GREY"
  printf '%*s\n' "$width" '' | tr ' ' "$char"
  printf '%b' "$RESET"
}

print_step_header() {
  WIZARD_STEP=$((WIZARD_STEP + 1))
  local title="$1"
  printf '\n'
  print_separator '='
  printf '%b  STEP %d/%d  %b%s%b\n' "$AMBER" "$WIZARD_STEP" "$WIZARD_TOTAL" "$WHITE" "$title" "$RESET"
  print_separator '-'
}

print_phase() {
  local icon="$1" label="$2"
  printf '\n%b  %s  %s%b\n\n' "$SAND" "$icon" "$label" "$RESET"
}

print_check() {
  local status="$1" label="$2"
  case "$status" in
    ok)   printf '  %b[PASS]%b %s\n' "$COLOR_GREEN" "$RESET" "$label" ;;
    warn) printf '  %b[WARN]%b %s\n' "$COLOR_YELLOW" "$RESET" "$label" ;;
    fail) printf '  %b[FAIL]%b %s\n' "$COLOR_RED" "$RESET" "$label" ;;
    skip) printf '  %b[SKIP]%b %s\n' "$GREY" "$RESET" "$label" ;;
    wait) printf '  %b[ .. ]%b %s\n' "$WATER" "$RESET" "$label" ;;
    info) printf '  %b[INFO]%b %s\n' "$COLOR_CYAN" "$RESET" "$label" ;;
  esac
}

print_option() {
  local num="$1" label="$2" desc="$3" extra="${4:-}"
  if [[ -n "$extra" ]]; then
    printf '    %b%s)%b %-14s %b%s%b  %b%s%b\n' "$AMBER" "$num" "$RESET" "$label" "$GREY" "$desc" "$RESET" "$SAGE" "$extra" "$RESET"
  else
    printf '    %b%s)%b %-14s %b%s%b\n' "$AMBER" "$num" "$RESET" "$label" "$GREY" "$desc" "$RESET"
  fi
}

print_value() {
  local label="$1" value="$2"
  printf '  %b%-22s%b %b%s%b\n' "$SAND" "$label" "$RESET" "$WHITE" "$value" "$RESET"
}

type_text() {
  local text="$1"
  local delay="${2:-0.02}"
  if [[ "$QUICK_MODE" == true ]]; then
    printf '%s' "$text"
    return
  fi
  for ((i = 0; i < ${#text}; i++)); do
    printf '%s' "${text:$i:1}"
    sleep "$delay" 2>/dev/null || true
  done
}

spinner() {
  local pid="$1" label="$2"
  local frames=('    ' ' .  ' ' .. ' ' ...' '  ..' '   .' '    ')
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf '\r  %b%s%b %s' "$AMBER" "${frames[$((i % ${#frames[@]}))]}" "$RESET" "$label"
    i=$((i + 1))
    sleep 0.3
  done
  printf '\r%*s\r' "$((${#label} + 12))" ''
}

wait_with_dots() {
  local seconds="$1" label="$2"
  printf '  %s ' "$label"
  for ((i = 0; i < seconds; i++)); do
    printf '%b.%b' "$AMBER" "$RESET"
    sleep 1
  done
  printf '\n'
}

choose() {
  local prompt="$1"
  local default="$2"
  shift 2
  local reply

  if [[ "$QUICK_MODE" == true ]]; then
    printf '%s\n' "$default"
    return
  fi

  while true; do
    printf '\n  %b>%b %s ' "$AMBER" "$RESET" "$prompt"
    if [[ -n "$default" ]]; then
      printf '%b[%s]%b ' "$GREY" "$default" "$RESET"
    fi
    read -r reply
    reply="${reply:-$default}"

    for valid in "$@"; do
      if [[ "$reply" == "$valid" ]]; then
        printf '%s\n' "$reply"
        return
      fi
    done
    printf '  %b  Invalid choice. Try again.%b\n' "$COLOR_RED" "$RESET"
  done
}

ask() {
  local prompt="$1"
  local default="${2:-}"
  local reply

  if [[ "$QUICK_MODE" == true && -n "$default" ]]; then
    printf '%s\n' "$default"
    return
  fi

  printf '\n  %b>%b %s ' "$AMBER" "$RESET" "$prompt"
  [[ -n "$default" ]] && printf '%b[%s]%b ' "$GREY" "$default" "$RESET"
  read -r reply
  printf '%s\n' "${reply:-$default}"
}

ask_secret() {
  local prompt="$1"
  local reply

  printf '\n  %b>%b %s ' "$AMBER" "$RESET" "$prompt"
  read -r -s reply
  printf '\n'
  printf '%s\n' "$reply"
}

yes_no() {
  local prompt="$1"
  local default="${2:-n}"

  if [[ "$QUICK_MODE" == true ]]; then
    printf '%s\n' "$default"
    return
  fi

  local hint="y/N"
  [[ "$default" =~ ^[Yy]$ ]] && hint="Y/n"

  printf '\n  %b>%b %s %b[%s]%b ' "$AMBER" "$RESET" "$prompt" "$GREY" "$hint" "$RESET"
  local reply
  read -r reply
  reply="${reply:-$default}"
  [[ "$reply" =~ ^[Yy]$ ]] && printf 'y\n' || printf 'n\n'
}

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------
check_prerequisites() {
  print_step_header "System Prerequisites"
  print_phase "🔍" "Scanning your system..."

  local fail_count=0

  # Docker
  if have_command docker && docker_daemon_ok; then
    local docker_ver
    docker_ver="$(docker --version 2>/dev/null | grep -oP '[\d]+\.[\d]+\.[\d]+' | head -1)"
    print_check ok "Docker Engine $docker_ver"
  else
    print_check fail "Docker Engine not found or not running"
    fail_count=$((fail_count + 1))
  fi

  # Docker Compose
  if docker_compose_ok; then
    local compose_ver
    compose_ver="$(docker compose version 2>/dev/null | grep -oP '[\d]+\.[\d]+\.[\d]+' | head -1)"
    print_check ok "Docker Compose v$compose_ver"
  else
    print_check fail "Docker Compose v2 not found"
    fail_count=$((fail_count + 1))
  fi

  # CPU AVX2
  if cpu_supports_avx2; then
    print_check ok "CPU supports AVX2 instructions"
  else
    print_check fail "CPU does not support AVX2 (required by Unreal Engine server)"
    fail_count=$((fail_count + 1))
  fi

  # Memory
  if [[ -f /proc/meminfo ]]; then
    local mem_total_mib
    mem_total_mib="$(host_memory_mib)"
    local mem_total_gib=$((mem_total_mib / 1024))
    if [[ "$mem_total_mib" -ge 20480 ]]; then
      print_check ok "RAM: ${mem_total_gib} GB (20 GB minimum)"
    elif [[ "$mem_total_mib" -ge 8192 ]]; then
      print_check warn "RAM: ${mem_total_gib} GB (20 GB recommended, basic profile may work)"
    else
      print_check fail "RAM: ${mem_total_gib} GB (minimum 8 GB required)"
      fail_count=$((fail_count + 1))
    fi
  else
    print_check skip "Cannot detect RAM (not Linux)"
  fi

  # Disk space
  local disk_avail_gb
  disk_avail_gb="$(df -BG "$PROJECT_ROOT" 2>/dev/null | awk 'NR==2 {gsub(/G/,"",$4); print $4}' || printf '0')"
  if [[ "$disk_avail_gb" -ge 50 ]]; then
    print_check ok "Disk: ${disk_avail_gb} GB available"
  elif [[ "$disk_avail_gb" -ge 25 ]]; then
    print_check warn "Disk: ${disk_avail_gb} GB available (50 GB recommended)"
  else
    print_check fail "Disk: ${disk_avail_gb} GB available (minimum 25 GB)"
    fail_count=$((fail_count + 1))
  fi

  # curl
  if have_command curl; then
    print_check ok "curl available"
  else
    print_check warn "curl not found (optional, used for IP detection)"
  fi

  # git
  if have_command git; then
    print_check ok "git available"
  else
    print_check info "git not found (optional, used for self-update)"
  fi

  if [[ "$fail_count" -gt 0 ]]; then
    printf '\n'
    log_error "$fail_count prerequisite(s) failed. Please fix them before continuing."
    if [[ "$(yes_no 'Continue anyway? (not recommended)' 'n')" != "y" ]]; then
      exit 1
    fi
  else
    printf '\n'
    log_success "All prerequisites passed!"
  fi
}

# ---------------------------------------------------------------------------
# Server Identity
# ---------------------------------------------------------------------------
configure_identity() {
  print_step_header "Server Identity"
  print_phase "🏛️" "Name your domain on Arrakis..."

  local name region datacenter

  name="$(ask 'Server display name' "${WORLD_NAME:-Dune Awakening Server}")"
  set_env_value WORLD_NAME "$name"

  printf '\n  %bChoose your region:%b\n' "$SAND" "$RESET"
  print_option 1 "North America" "US East/West, Canada"
  print_option 2 "Europe"        "EU Central, UK, Nordic"
  print_option 3 "Asia Pacific"  "Japan, Korea, Australia"
  print_option 4 "South America" "Brazil, Chile"

  local region_choice
  region_choice="$(choose 'Region' '1' 1 2 3 4)"

  case "$region_choice" in
    1) region="North America"; datacenter="North America" ;;
    2) region="Europe";        datacenter="Europe" ;;
    3) region="Asia Pacific";  datacenter="Asia" ;;
    4) region="South America"; datacenter="South America" ;;
  esac

  set_env_value WORLD_REGION "$region"
  set_env_value WORLD_DATACENTER_ID "$datacenter"

  printf '\n'
  print_value "Server name:" "$name"
  print_value "Region:" "$region"
}

# ---------------------------------------------------------------------------
# Deployment profile
# ---------------------------------------------------------------------------
configure_profile() {
  print_step_header "Deployment Profile"

  local mem_total_gib=0
  if [[ -f /proc/meminfo ]]; then
    mem_total_gib=$(($(host_memory_mib) / 1024))
  fi

  printf '\n'
  printf '  %bSelect how many maps to run:%b\n\n' "$SAND" "$RESET"

  # Determine recommended profile based on RAM
  local recommended="basic"
  [[ "$mem_total_gib" -ge 32 ]] && recommended="standard"
  [[ "$mem_total_gib" -ge 48 ]] && recommended="full"

  local rec_basic="" rec_standard="" rec_full=""
  case "$recommended" in
    basic)    rec_basic="<-- recommended for ${mem_total_gib}GB RAM" ;;
    standard) rec_standard="<-- recommended for ${mem_total_gib}GB RAM" ;;
    full)     rec_full="<-- recommended for ${mem_total_gib}GB RAM" ;;
  esac

  cat <<EOF
    ${AMBER}+${GREY}-----${AMBER}+${GREY}----------------${AMBER}+${GREY}--------${AMBER}+${GREY}-----------------------------${AMBER}+${RESET}
    ${AMBER}|${RESET}  #  ${AMBER}|${RESET} Profile        ${AMBER}|${RESET}  RAM   ${AMBER}|${RESET} Maps                        ${AMBER}|${RESET}
    ${AMBER}+${GREY}-----${AMBER}+${GREY}----------------${AMBER}+${GREY}--------${AMBER}+${GREY}-----------------------------${AMBER}+${RESET}
    ${AMBER}|${RESET}  1  ${AMBER}|${WHITE} basic          ${AMBER}|${RESET} ~20 GB ${AMBER}|${RESET} Survival + Overmap          ${AMBER}|${RESET} ${SAGE}${rec_basic}${RESET}
    ${AMBER}|${RESET}  2  ${AMBER}|${WHITE} standard       ${AMBER}|${RESET} ~35 GB ${AMBER}|${RESET} + Deep Desert + Story       ${AMBER}|${RESET} ${SAGE}${rec_standard}${RESET}
    ${AMBER}|${RESET}  3  ${AMBER}|${WHITE} full           ${AMBER}|${RESET} ~48 GB ${AMBER}|${RESET} All maps (every zone)       ${AMBER}|${RESET} ${SAGE}${rec_full}${RESET}
    ${AMBER}+${GREY}-----${AMBER}+${GREY}----------------${AMBER}+${GREY}--------${AMBER}+${GREY}-----------------------------${AMBER}+${RESET}
EOF

  local default_num=1
  case "$recommended" in
    standard) default_num=2 ;;
    full)     default_num=3 ;;
  esac

  local profile_choice
  profile_choice="$(choose 'Profile' "$default_num" 1 2 3)"

  local profile
  case "$profile_choice" in
    1) profile="basic" ;;
    2) profile="standard" ;;
    3) profile="full" ;;
  esac

  set_env_value DEPLOYMENT_PROFILE "$profile"
  export DEPLOYMENT_PROFILE="$profile"

  printf '\n'
  print_value "Profile:" "$profile ($(profile_memory_label "$profile"))"
}

# ---------------------------------------------------------------------------
# Network configuration
# ---------------------------------------------------------------------------
configure_network() {
  print_step_header "Network Configuration"
  print_phase "🌐" "Setting up connectivity..."

  # Detect public IP
  local detected_ip=""
  printf '  Detecting public IP'
  if detected_ip="$(curl -fsS --connect-timeout 5 api.ipify.org 2>/dev/null)"; then
    printf ' %b%s%b\n' "$COLOR_GREEN" "$detected_ip" "$RESET"
  else
    printf ' %b(could not detect)%b\n' "$COLOR_YELLOW" "$RESET"
  fi

  local pub_ip
  pub_ip="$(ask 'Public IP address (or "auto" for runtime detection)' "${detected_ip:-auto}")"
  set_env_value EXTERNAL_ADDRESS "$pub_ip"

  # Dashboard bind
  printf '\n  %bDashboard access:%b\n' "$SAND" "$RESET"
  print_option 1 "localhost"  "Only accessible from this machine (safest)"
  print_option 2 "LAN"       "Accessible from your local network"
  print_option 3 "public"    "Accessible from anywhere (use with caution)"

  local bind_choice
  bind_choice="$(choose 'Dashboard binding' '2' 1 2 3)"

  local bind_addr
  case "$bind_choice" in
    1) bind_addr="127.0.0.1" ;;
    2) bind_addr="0.0.0.0" ;;
    3) bind_addr="0.0.0.0" ;;
  esac
  set_env_value DUNE_ADMIN_BIND_ADDRESS "$bind_addr"

  local dash_port
  dash_port="$(ask 'Dashboard port' "${DUNE_ADMIN_HOST_PORT:-18080}")"
  set_env_value DUNE_ADMIN_HOST_PORT "$dash_port"

  printf '\n'
  print_value "Public IP:" "$pub_ip"
  print_value "Dashboard:" "${bind_addr}:${dash_port}"

  printf '\n  %bRequired ports (ensure these are forwarded/open):%b\n\n' "$SAND" "$RESET"
  cat <<EOF
    ${AMBER}+${GREY}-----------${AMBER}+${GREY}----------${AMBER}+${GREY}----------------------------------${AMBER}+${RESET}
    ${AMBER}|${RESET} Port      ${AMBER}|${RESET} Protocol ${AMBER}|${RESET} Purpose                          ${AMBER}|${RESET}
    ${AMBER}+${GREY}-----------${AMBER}+${GREY}----------${AMBER}+${GREY}----------------------------------${AMBER}+${RESET}
    ${AMBER}|${RESET} 7777-7810 ${AMBER}|${RESET} UDP      ${AMBER}|${RESET} Game client connections           ${AMBER}|${RESET}
    ${AMBER}|${RESET} 7888-7920 ${AMBER}|${RESET} UDP      ${AMBER}|${RESET} Server-to-server communication   ${AMBER}|${RESET}
    ${AMBER}|${RESET} 31982     ${AMBER}|${RESET} TCP      ${AMBER}|${RESET} RabbitMQ (player auth)           ${AMBER}|${RESET}
    ${AMBER}|${RESET} 31983     ${AMBER}|${RESET} TCP      ${AMBER}|${RESET} RabbitMQ HTTP (token auth)       ${AMBER}|${RESET}
    ${AMBER}|${RESET} ${dash_port}     ${AMBER}|${RESET} TCP      ${AMBER}|${RESET} Dashboard (admin panel)          ${AMBER}|${RESET}
    ${AMBER}+${GREY}-----------${AMBER}+${GREY}----------${AMBER}+${GREY}----------------------------------${AMBER}+${RESET}
EOF
}

# ---------------------------------------------------------------------------
# Authentication & Secrets
# ---------------------------------------------------------------------------
configure_secrets() {
  print_step_header "Authentication & Secrets"
  print_phase "🔑" "Securing your fortress..."

  # Funcom token
  local existing_token
  existing_token="$(read_funcom_token || true)"

  if [[ -n "$existing_token" ]]; then
    local masked="${existing_token:0:8}...${existing_token: -4}"
    print_check ok "Funcom token found: $masked"
    if [[ "$(yes_no 'Replace existing Funcom token?' 'n')" == "y" ]]; then
      existing_token=""
    fi
  fi

  if [[ -z "$existing_token" ]]; then
    printf '\n  %bGet your token from: %bhttps://account.duneawakening.com/%b\n' "$SAND" "$WATER" "$RESET"
    local token
    token="$(ask_secret 'Paste your Funcom FLS token')"
    if [[ -n "$token" ]]; then
      write_secret_file "$SECRET_DIR/funcom-token.txt" "$token"
      set_env_value FLS_SECRET "$token"
      print_check ok "Funcom token saved"
    else
      print_check warn "No token provided (server won't appear in browser)"
    fi
  fi

  # Auto-generate secure passwords
  printf '\n  %bGenerating secure credentials...%b\n\n' "$SAND" "$RESET"

  local pg_pass pg_dune_pass rmq_secret admin_token

  pg_pass="$(strip_wrapping_quotes "${POSTGRES_SUPER_PASSWORD:-change-me-postgres-super}")"
  if [[ "$pg_pass" == "change-me-postgres-super" || -z "$pg_pass" ]]; then
    pg_pass="$(random_password)"
    set_env_value POSTGRES_SUPER_PASSWORD "$pg_pass"
    print_check ok "Generated Postgres super password"
  else
    print_check ok "Postgres super password already set"
  fi

  pg_dune_pass="$(strip_wrapping_quotes "${POSTGRES_DUNE_PASSWORD:-change-me-dune-db}")"
  if [[ "$pg_dune_pass" == "change-me-dune-db" || -z "$pg_dune_pass" ]]; then
    pg_dune_pass="$(random_password)"
    set_env_value POSTGRES_DUNE_PASSWORD "$pg_dune_pass"
    print_check ok "Generated Postgres dune password"
  else
    print_check ok "Postgres dune password already set"
  fi

  rmq_secret="$(strip_wrapping_quotes "${RMQ_HTTP_TOKEN_AUTH_SECRET:-}")"
  if [[ -z "$rmq_secret" ]]; then
    rmq_secret="$(random_password)"
    set_env_value RMQ_HTTP_TOKEN_AUTH_SECRET "$rmq_secret"
    print_check ok "Generated RabbitMQ auth secret"
  else
    print_check ok "RabbitMQ auth secret already set"
  fi

  admin_token="$(strip_wrapping_quotes "${DUNE_ADMIN_TOKEN:-change-me-admin-token}")"
  if [[ "$admin_token" == "change-me-admin-token" || "$admin_token" == "changeme" || -z "$admin_token" ]]; then
    admin_token="$(random_token 24)"
    set_env_value DUNE_ADMIN_TOKEN "$admin_token"
    print_check ok "Generated dashboard admin token"
    printf '\n  %b  Save this token - you need it to access the dashboard:%b\n' "$SPICE" "$RESET"
    printf '  %b  %s%b\n' "$WHITE" "$admin_token" "$RESET"
  else
    print_check ok "Dashboard admin token already set"
  fi
}

# ---------------------------------------------------------------------------
# FLS Environment
# ---------------------------------------------------------------------------
configure_environment() {
  print_step_header "Game Environment"
  print_phase "🎮" "Choose your battlefield..."

  printf '  %bServer environment:%b\n' "$SAND" "$RESET"
  print_option 1 "Live (retail)"  "Production servers - play with everyone"
  print_option 2 "PTC (beta)"     "Public Test Channel - early access builds"

  local env_choice
  env_choice="$(choose 'Environment' '1' 1 2)"

  local fls_env steam_app_id
  case "$env_choice" in
    1) fls_env="retail"; steam_app_id="4754530" ;;
    2) fls_env="beta";   steam_app_id="3104830" ;;
  esac

  set_env_value DUNE_FLS_ENV "$fls_env"
  set_env_value STEAM_APP_ID "$steam_app_id"

  # Server password (optional)
  printf '\n'
  local server_pass
  server_pass="$(ask 'Server login password (blank for no password)' '')"
  if [[ -n "$server_pass" ]]; then
    set_env_value DUNE_SERVER_LOGIN_PASSWORD "$server_pass"
    print_check ok "Server password set"
  else
    print_check info "No server password (open to all)"
  fi

  printf '\n'
  print_value "Environment:" "$fls_env"
  print_value "Steam App ID:" "$steam_app_id"
}

# ---------------------------------------------------------------------------
# Optional features
# ---------------------------------------------------------------------------
configure_features() {
  print_step_header "Optional Features"
  print_phase "⚙️" "Customize your Nexus..."

  # Backups
  printf '  %bAutomatic backups:%b\n' "$SAND" "$RESET"
  local backup_enabled
  backup_enabled="$(yes_no 'Enable scheduled auto-backups?' 'y')"
  if [[ "$backup_enabled" == "y" ]]; then
    set_env_value BACKUP_SCHEDULE_ENABLED "true"
    local interval
    interval="$(ask 'Backup interval (hours)' '24')"
    set_env_value BACKUP_SCHEDULE_INTERVAL_HOURS "$interval"
    local retention
    retention="$(ask 'Backup retention (days)' '7')"
    set_env_value BACKUP_RETENTION_DAYS "$retention"
    print_check ok "Auto-backups: every ${interval}h, keep ${retention} days"
  else
    set_env_value BACKUP_SCHEDULE_ENABLED "false"
    print_check info "Auto-backups disabled"
  fi

  # Discord
  printf '\n  %bDiscord notifications:%b\n' "$SAND" "$RESET"
  local discord_url
  discord_url="$(ask 'Discord webhook URL (blank to skip)' "${DISCORD_WEBHOOK_URL:-}")"
  if [[ -n "$discord_url" ]]; then
    set_env_value DISCORD_WEBHOOK_URL "$discord_url"
    print_check ok "Discord webhook configured"
  else
    print_check info "Discord notifications disabled"
  fi

  # Chat guard
  printf '\n  %bChat spam protection:%b\n' "$SAND" "$RESET"
  local chat_guard
  chat_guard="$(yes_no 'Enable chat spam protection?' 'y')"
  if [[ "$chat_guard" == "y" ]]; then
    set_env_value DUNE_CHAT_GUARD_ENABLED "true"
    print_check ok "Chat guard enabled"
  else
    set_env_value DUNE_CHAT_GUARD_ENABLED "false"
  fi

  # Economy monitoring
  local econ_mon
  econ_mon="$(yes_no 'Enable economy anomaly monitoring?' 'y')"
  set_env_value DUNE_ECONOMY_MONITORING "$([[ "$econ_mon" == "y" ]] && echo true || echo false)"
}

# ---------------------------------------------------------------------------
# Docker image loading
# ---------------------------------------------------------------------------
load_images() {
  print_step_header "Docker Images"
  print_phase "📦" "Loading Funcom server images..."

  local steam_dir
  steam_dir="$(strip_wrapping_quotes "${DUNE_STEAM_SERVER_DIR:-./steam}")"

  if [[ ! -d "$PROJECT_ROOT/$steam_dir" ]]; then
    printf '  %bServer files not found at: %s%b\n\n' "$COLOR_YELLOW" "$steam_dir" "$RESET"
    printf '  Download them first with SteamCMD:\n'
    printf '  %b  steamcmd +login anonymous +app_update %s validate +quit%b\n\n' "$WATER" "${STEAM_APP_ID:-4754530}" "$RESET"

    steam_dir="$(ask 'Path to Steam server files' "$steam_dir")"
    set_env_value DUNE_STEAM_SERVER_DIR "$steam_dir"
  fi

  if [[ -f "$PROJECT_ROOT/scripts/load-images.sh" ]]; then
    # Invoked via `bash` (not direct exec) and checked for existence (-f) rather
    # than executability (-x): a lost executable bit should not silently skip
    # image loading the way it once silently skipped CPU pinning (see CHANGELOG).
    bash "$PROJECT_ROOT/scripts/load-images.sh" || {
      print_check warn "Image loading had issues - containers may still work if images were previously loaded"
    }
    load_env_file
    print_check ok "Docker images loaded"
  else
    print_check warn "load-images.sh not found - ensure images are available"
  fi
}

# ---------------------------------------------------------------------------
# Deploy!
# ---------------------------------------------------------------------------
deploy_containers() {
  print_step_header "Deployment"

  # Show a recap before deploying
  load_env_file
  printf '\n'
  printf '  %b%bDEPLOYMENT SUMMARY%b\n' "$AMBER" "$COLOR_BOLD" "$RESET"
  print_separator '-' 50
  print_value "Server:" "$(strip_wrapping_quotes "${WORLD_NAME:-Dune Server}")"
  print_value "Region:" "$(strip_wrapping_quotes "${WORLD_REGION:-North America}")"
  print_value "Profile:" "$(strip_wrapping_quotes "${DEPLOYMENT_PROFILE:-basic}")"
  print_value "Environment:" "$(strip_wrapping_quotes "${DUNE_FLS_ENV:-beta}")"
  print_value "Public IP:" "$(strip_wrapping_quotes "${EXTERNAL_ADDRESS:-auto}")"
  print_value "Dashboard:" "$(strip_wrapping_quotes "${DUNE_ADMIN_BIND_ADDRESS:-127.0.0.1}"):$(strip_wrapping_quotes "${DUNE_ADMIN_HOST_PORT:-18080}")"
  print_value "Auto-backup:" "$(strip_wrapping_quotes "${BACKUP_SCHEDULE_ENABLED:-false}")"
  print_separator '-' 50

  if [[ "$DRY_RUN" == true ]]; then
    printf '\n  %b--dry-run mode: skipping actual deployment%b\n' "$COLOR_YELLOW" "$RESET"
    return 0
  fi

  if [[ "$(yes_no 'Deploy now?' 'y')" != "y" ]]; then
    printf '\n  Deployment cancelled. Your .env is saved - run %b./dune start%b when ready.\n' "$AMBER" "$RESET"
    return 0
  fi

  printf '\n'

  # Create directories
  ensure_directory "$BACKUP_DIR"
  ensure_directory "$CONFIG_DIR"
  ensure_directory "$SECRET_DIR"

  # Permissions
  chmod 700 "$SECRET_DIR" 2>/dev/null || true
  find "$SECRET_DIR" -type f -exec chmod 600 {} \; 2>/dev/null || true
  print_check ok "Directory permissions set"

  # Start infrastructure first
  printf '\n'
  type_text "  Initializing Arrakis infrastructure"
  printf '\n\n'

  local services_order=(
    "postgres:Database (PostgreSQL)"
    "admin-rmq:Message broker (Admin RabbitMQ)"
    "game-rmq:Message broker (Game RabbitMQ)"
    "db-init:Database schema initialization"
    "director:Battlegroup Director"
    "gateway:Gateway server"
    "auth-shim:Auth shim"
    "text-router:Text router"
  )

  # Start infrastructure
  run_compose up -d postgres admin-rmq game-rmq 2>/dev/null &
  spinner $! "Starting core infrastructure..."
  wait $! 2>/dev/null || true
  print_check ok "Core infrastructure started"

  # Wait for postgres health
  printf '  Waiting for database'
  local pg_wait=0
  while [[ "$pg_wait" -lt 30 ]]; do
    if docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
      printf ' %b ready%b\n' "$COLOR_GREEN" "$RESET"
      break
    fi
    printf '.'
    sleep 2
    pg_wait=$((pg_wait + 2))
  done
  [[ "$pg_wait" -ge 30 ]] && printf ' %b(timeout - continuing anyway)%b\n' "$COLOR_YELLOW" "$RESET"

  # DB init
  if service_exists db-init; then
    run_compose run --rm db-init >/dev/null 2>&1 &
    spinner $! "Initializing database schema..."
    wait $! 2>/dev/null || true
    print_check ok "Database initialized"
  fi

  # Start remaining services
  run_compose up -d 2>/dev/null &
  spinner $! "Starting all services..."
  wait $! 2>/dev/null || true
  print_check ok "All containers started"

  # Wait a moment for containers to settle
  wait_with_dots 5 "Waiting for services to initialize"

  # Show container status
  printf '\n  %b%bContainer Status:%b\n\n' "$SAND" "$COLOR_BOLD" "$RESET"

  local container_list
  container_list="$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || echo '  (could not query container status)')"
  printf '%s\n' "$container_list" | while IFS= read -r line; do
    if echo "$line" | grep -qi 'up\|healthy\|running'; then
      printf '  %b%s%b\n' "$COLOR_GREEN" "$line" "$RESET"
    elif echo "$line" | grep -qi 'exit\|dead\|error'; then
      printf '  %b%s%b\n' "$COLOR_RED" "$line" "$RESET"
    else
      printf '  %s\n' "$line"
    fi
  done
}

# ---------------------------------------------------------------------------
# Finale
# ---------------------------------------------------------------------------
print_finale() {
  local elapsed=$(( $(date +%s) - DEPLOY_START_TIME ))
  local minutes=$((elapsed / 60))
  local seconds=$((elapsed % 60))

  printf '\n'
  print_separator '='

  printf '%b' "$AMBER"
  cat <<'FINALE'

        .     .       .           .       .
   .       .       .       .           .
       . ______________________________ .
      . /                              \ .
   . /    DEPLOYMENT COMPLETE            \
  . /                                      \   .
  |   The spice must flow.                  |
  |                                         |    .
  |   Your server awaits at Arrakis.        |
   .\                                     / .
     .\_______________________________ /    .
        .           .       .           .
    .       .           .       .           .

FINALE
  printf '%b' "$RESET"

  local dash_addr
  dash_addr="$(strip_wrapping_quotes "${DUNE_ADMIN_BIND_ADDRESS:-127.0.0.1}")"
  local dash_port
  dash_port="$(strip_wrapping_quotes "${DUNE_ADMIN_HOST_PORT:-18080}")"

  if [[ "$dash_addr" == "0.0.0.0" ]]; then
    local local_ip
    local_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')"
    dash_addr="$local_ip"
  fi

  printf '  %b%bQuick Reference:%b\n\n' "$SAND" "$COLOR_BOLD" "$RESET"
  print_value "Dashboard:" "http://${dash_addr}:${dash_port}"
  print_value "Public Status:" "http://${dash_addr}:${dash_port}/public"
  print_value "Deployed in:" "${minutes}m ${seconds}s"
  printf '\n'
  printf '  %b%bUseful commands:%b\n\n' "$SAND" "$COLOR_BOLD" "$RESET"
  printf '    %b./dune status%b      Show container health\n' "$AMBER" "$RESET"
  printf '    %b./dune logs%b        Tail live server logs\n' "$AMBER" "$RESET"
  printf '    %b./dune doctor%b      Run diagnostics\n' "$AMBER" "$RESET"
  printf '    %b./dune backup%b      Create a backup\n' "$AMBER" "$RESET"
  printf '    %b./dune stop%b        Gracefully stop all services\n' "$AMBER" "$RESET"
  printf '    %b./dune restart%b     Restart the stack\n' "$AMBER" "$RESET"
  printf '    %b./dune update%b      Download latest game server files\n' "$AMBER" "$RESET"
  printf '    %bmake smoke%b        Post-deploy smoke test\n' "$AMBER" "$RESET"
  printf '\n'
  print_separator '='
  printf '\n  %b"He who controls the spice controls the universe."%b\n' "$ITALIC$SAND" "$RESET"
  printf '  %b                              - Baron Vladimir Harkonnen%b\n\n' "$GREY" "$RESET"
}

# =============================================================================
# MAIN
# =============================================================================
clear 2>/dev/null || true
print_sandworm
print_logo
printf '\n'
type_text "  Welcome to the Arrakis Command Nexus deployment wizard."
printf '\n'
type_text "  This will guide you through setting up your Dune Awakening server."
printf '\n\n'
printf '  %bVersion: %s  |  Profile: %s  |  Project: %s%b\n' "$GREY" "$(version_string)" "${DEPLOYMENT_PROFILE:-basic}" "$PROJECT_ROOT" "$RESET"

if [[ "$QUICK_MODE" == true ]]; then
  printf '\n  %b  Quick mode enabled - using defaults where possible%b\n' "$WATER" "$RESET"
fi

check_prerequisites
configure_identity
configure_profile
configure_network
configure_secrets
configure_environment
configure_features
load_images
deploy_containers
print_finale
