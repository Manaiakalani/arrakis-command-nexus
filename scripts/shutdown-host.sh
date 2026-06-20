#!/usr/bin/env bash
# shutdown-host.sh — Gracefully shut down the entire Dune stack and the host machine.
#
# Two-phase flow:
#   Phase 1 (in-container): POST /api/system/prepare-shutdown
#     → in-game warnings, final backup, stop game + infra containers
#   Phase 2 (this script, on the host):
#     → docker compose down (stops postgres + dashboard + remaining)
#     → optional: sudo shutdown -h now
#
# Usage:
#   ./scripts/shutdown-host.sh                        # 5 min warning, dry-run (no power-off)
#   ./scripts/shutdown-host.sh --warning 2 --confirm  # 2 min warning, then power off
#   ./scripts/shutdown-host.sh --warning 0 --confirm  # immediate, then power off
#   ./scripts/shutdown-host.sh --no-poweroff          # stop everything, leave host on
#   ./scripts/shutdown-host.sh --skip-backup          # skip the final backup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
if [[ -f "$SCRIPT_DIR/lib/common.sh" ]]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/lib/common.sh"
  # NOTE: we deliberately do NOT call init_dune_env here — it sources .env
  # which may contain values with unquoted spaces that break with `set -e`.
  # We pull only the env keys we need ourselves below.
else
  log_step()    { printf '\n→ %s\n' "$*"; }
  log_success() { printf '✓ %s\n' "$*"; }
  log_warn()    { printf '⚠ %s\n' "$*" >&2; }
  log_error()   { printf '✗ %s\n' "$*" >&2; }
fi

WARNING_MINUTES=5
CONFIRM_POWEROFF=0
NO_POWEROFF=0
SKIP_BACKUP=0
DRY_RUN=0

usage() {
  sed -n '2,16p' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --warning|-w) WARNING_MINUTES="${2:-5}"; shift 2 ;;
    --confirm)    CONFIRM_POWEROFF=1; shift ;;
    --no-poweroff) NO_POWEROFF=1; shift ;;
    --skip-backup) SKIP_BACKUP=1; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    usage ;;
    *) log_error "Unknown arg: $1"; exit 2 ;;
  esac
done

# Resolve dashboard URL + admin token from .env (or environment).
# Don't blindly `source` .env — some values legitimately contain spaces or
# UE5 chat strings that won't survive bash expansion. Pull only the keys we
# need with a small grep.
ENV_FILE="$PROJECT_ROOT/.env"
read_env_var() {
  local key="$1"
  if [[ -f "$ENV_FILE" ]]; then
    # Use awk so a missing key doesn't break `set -o pipefail`.
    awk -F= -v k="$key" '$1==k{sub(/^[^=]*=/,""); val=$0} END{
      gsub(/^["\x27]|["\x27]$/, "", val); print val
    }' "$ENV_FILE"
  fi
}
DASHBOARD_HOST="${DASHBOARD_HOST:-$(read_env_var DASHBOARD_HOST)}"
DASHBOARD_HOST="${DASHBOARD_HOST:-127.0.0.1}"
DASHBOARD_PORT="${DASHBOARD_PORT:-$(read_env_var DASHBOARD_PORT)}"
DASHBOARD_PORT="${DASHBOARD_PORT:-18080}"
API_BASE="http://${DASHBOARD_HOST}:${DASHBOARD_PORT}/api"
ADMIN_TOKEN="${DASHBOARD_ADMIN_TOKEN:-${ADMIN_TOKEN:-$(read_env_var DUNE_ADMIN_TOKEN)}}"
DEPLOYMENT_PROFILE="${DEPLOYMENT_PROFILE:-$(read_env_var DEPLOYMENT_PROFILE)}"
DEPLOYMENT_PROFILE="${DEPLOYMENT_PROFILE:-basic}"

if [[ -z "${ADMIN_TOKEN}" ]]; then
  log_error "DASHBOARD_ADMIN_TOKEN not set. Cannot call dashboard API."
  exit 1
fi

log_step "Preflight: checking dashboard reachability at $API_BASE"
if ! curl -fsS -m 5 -H "X-Admin-Token: $ADMIN_TOKEN" "$API_BASE/status" >/dev/null 2>&1; then
  log_warn "Dashboard not reachable; will skip Phase 1 and go straight to docker compose down."
  SKIP_PHASE1=1
else
  SKIP_PHASE1=0
  log_success "Dashboard reachable."
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo
  echo "DRY RUN — would perform:"
  echo "  Phase 1: POST $API_BASE/system/prepare-shutdown (warning=${WARNING_MINUTES}m, skip_backup=$SKIP_BACKUP)"
  echo "  Phase 2: cd $PROJECT_ROOT && docker compose [-f compose files] down"
  if [[ $CONFIRM_POWEROFF -eq 1 && $NO_POWEROFF -eq 0 ]]; then
    echo "  Phase 3: sudo shutdown -h now"
  else
    echo "  Phase 3: SKIPPED (no --confirm or --no-poweroff)"
  fi
  exit 0
fi

# ----- Phase 1: dashboard prepares the shutdown -----
if [[ $SKIP_PHASE1 -eq 0 ]]; then
  log_step "Phase 1: requesting dashboard prepare-shutdown (warning=${WARNING_MINUTES}m)"
  PAYLOAD=$(printf '{"warning_minutes":%d,"skip_backup":%s,"stop_game_servers":true}' \
      "$WARNING_MINUTES" "$([[ $SKIP_BACKUP -eq 1 ]] && echo true || echo false)")
  curl -fsS -m 10 \
    -H "X-Admin-Token: $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -X POST -d "$PAYLOAD" \
    "$API_BASE/system/prepare-shutdown" | sed 's/^/  /'
  echo

  TOTAL_WAIT=$(( WARNING_MINUTES * 60 + 90 ))
  log_step "Polling shutdown-status (up to ${TOTAL_WAIT}s)"
  ELAPSED=0
  while (( ELAPSED < TOTAL_WAIT )); do
    sleep 5
    ELAPSED=$(( ELAPSED + 5 ))
    PHASE=$(curl -fsS -m 5 -H "X-Admin-Token: $ADMIN_TOKEN" \
              "$API_BASE/system/shutdown-status" 2>/dev/null \
              | python3 -c 'import sys,json;print(json.load(sys.stdin).get("phase","?"))' 2>/dev/null \
              || echo "unreachable")
    printf '  [%4ds] phase=%s\n' "$ELAPSED" "$PHASE"
    case "$PHASE" in
      ready_for_host_shutdown) log_success "Phase 1 done."; break ;;
      error)                   log_error "Phase 1 reported error. Check dashboard logs."; break ;;
      unreachable)
        # Dashboard might have stopped itself (it shouldn't, but tolerate it).
        log_warn "Dashboard unreachable; proceeding to Phase 2."
        break
        ;;
    esac
  done
fi

# ----- Phase 2: bring down the rest of the stack from the host -----
log_step "Phase 2: docker compose down"
cd "$PROJECT_ROOT"
COMPOSE_ARGS=( -f docker-compose.yml -f "docker-compose.${DEPLOYMENT_PROFILE:-basic}.yml" )
HOSTNET_OVERLAY="${DUNE_HOSTNET_OVERLAY:-$(read_env_var DUNE_HOSTNET_OVERLAY)}"
if [[ -n "${HOSTNET_OVERLAY:-}" && -f "${PROJECT_ROOT}/${HOSTNET_OVERLAY}" ]]; then
  COMPOSE_ARGS+=( -f "$HOSTNET_OVERLAY" )
fi
COMPOSE_ARGS+=( -f docker-compose.dashboard.yml )
docker compose "${COMPOSE_ARGS[@]}" down --remove-orphans
log_success "All containers stopped."

# ----- Phase 3: power off the host -----
if [[ $NO_POWEROFF -eq 1 ]]; then
  log_success "All done. Host left running (--no-poweroff)."
  exit 0
fi
if [[ $CONFIRM_POWEROFF -ne 1 ]]; then
  log_warn "Power-off skipped: re-run with --confirm to actually shut down the host."
  log_warn "  e.g.   sudo shutdown -h now"
  exit 0
fi

log_step "Phase 3: sudo shutdown -h now (you may be prompted for your password)"
sudo shutdown -h now
