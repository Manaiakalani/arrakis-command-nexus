#!/usr/bin/env bash
# =============================================================================
# Arrakis Command Nexus - Post-Deploy Smoke Test
# =============================================================================
# Runs after every deploy to catch regressions before they become problems.
# Validates: API endpoints, volume mounts, DB persistence, frontend routes,
# container health, and critical configuration.
#
# Usage:
#   ./scripts/smoke-test.sh              Run all checks
#   ./scripts/smoke-test.sh --quick      API + health only (skip volume checks)
#   DUNE_ADMIN_TOKEN=xxx ./scripts/smoke-test.sh
#
# Exit codes:
#   0  All checks passed
#   1  One or more checks failed
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
QUICK_MODE=false
[[ "${1:-}" == "--quick" ]] && QUICK_MODE=true

DASHBOARD_PORT="${DUNE_ADMIN_HOST_PORT:-18080}"
DASHBOARD_URL="http://localhost:${DASHBOARD_PORT}"

if [[ -f "$PROJECT_ROOT/.env" ]]; then
  # Source .env safely: handle unquoted spaces by quoting values
  eval "$(grep -v '^\s*#' "$PROJECT_ROOT/.env" | grep -v '^\s*$' | sed 's/=\(.*\)/="\1"/' | sed 's/^/export /')"
fi

ADMIN_TOKEN="${DUNE_ADMIN_TOKEN:-}"
if [[ -z "$ADMIN_TOKEN" ]]; then
  echo "ERROR: DUNE_ADMIN_TOKEN not set. Export it or add to .env"
  exit 1
fi

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
PASS=0
FAIL=0
WARN=0

pass() { ((PASS+=1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { ((FAIL+=1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }
warn() { ((WARN+=1)); printf '  \033[33m!\033[0m %s\n' "$1"; }
section() { printf '\n\033[1;38;5;214m── %s ──\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
# 1. Container Health
# ---------------------------------------------------------------------------
section "Container Health"

check_container() {
  local name="$1"
  local status
  status="$(docker inspect --format='{{.State.Health.Status}}' "$name" 2>/dev/null || echo "missing")"
  case "$status" in
    healthy)   pass "$name is healthy" ;;
    unhealthy) fail "$name is unhealthy" ;;
    starting)  warn "$name is still starting" ;;
    *)
      # No healthcheck defined, check if running
      local running
      running="$(docker inspect --format='{{.State.Running}}' "$name" 2>/dev/null || echo "false")"
      if [[ "$running" == "true" ]]; then
        pass "$name is running"
      else
        fail "$name is not running (status: $status)"
      fi
      ;;
  esac
}

for svc in dashboard-api dashboard-frontend; do
  check_container "dune-awakening-${svc}-1"
done

# ---------------------------------------------------------------------------
# 2. API Endpoint Health
# ---------------------------------------------------------------------------
section "API Endpoints"

check_api() {
  local path="$1"
  local label="${2:-$path}"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    "${DASHBOARD_URL}${path}" 2>/dev/null)"
  if [[ "$code" == "200" ]]; then
    pass "$label (200)"
  else
    fail "$label (HTTP $code)"
  fi
}

check_api "/api/health" "Health endpoint"
check_api "/api/status" "Server status"
check_api "/api/system/version" "System version"
check_api "/api/system/resources" "System resources"
check_api "/api/discord/webhooks" "Discord webhooks"
check_api "/api/config" "Config files"
check_api "/api/backups" "Backups list"
check_api "/api/players" "Players list"
check_api "/api/audit?limit=5" "Audit trail"
check_api "/api/announce/scheduled" "Scheduled announcements"
check_api "/api/restart/schedule" "Restart schedule"

# ---------------------------------------------------------------------------
# 3. Frontend Routes
# ---------------------------------------------------------------------------
section "Frontend Routes"

check_route() {
  local path="$1"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' \
    "${DASHBOARD_URL}${path}" 2>/dev/null)"
  if [[ "$code" == "200" ]]; then
    pass "$path (200)"
  else
    fail "$path (HTTP $code)"
  fi
}

ROUTES=(
  "/" "/maps" "/players" "/characters" "/config" "/resources"
  "/logs" "/system" "/economy" "/backups" "/moderation"
  "/discord" "/announcements" "/watchdog" "/audit" "/settings"
  "/public"
)
for route in "${ROUTES[@]}"; do
  check_route "$route"
done

if $QUICK_MODE; then
  section "Summary (quick mode)"
  printf '  Passed: %d  Failed: %d  Warnings: %d\n' "$PASS" "$FAIL" "$WARN"
  exit $((FAIL > 0 ? 1 : 0))
fi

# ---------------------------------------------------------------------------
# 4. Volume Mounts & Data Persistence
# ---------------------------------------------------------------------------
section "Volume Mounts & Persistence"

# Dashboard DB must be on a persistent mount
db_path="$(docker exec dune-awakening-dashboard-api-1 \
  python3 -c "import os; print(os.getenv('DUNE_DASHBOARD_DB_URL',''))" 2>/dev/null || echo "")"
if echo "$db_path" | grep -q "/workspace/data"; then
  pass "Dashboard DB points to persistent volume (/workspace/data/)"
else
  fail "Dashboard DB is NOT on a persistent volume (was: $db_path)"
fi

# Check the DB file exists and has tables
table_count="$(docker exec dune-awakening-dashboard-api-1 \
  python3 -c "import sqlite3,os; db=os.getenv('DUNE_DASHBOARD_DB_URL','').replace('sqlite+aiosqlite:///',''); c=sqlite3.connect(db); r=c.execute(\"SELECT count(*) FROM sqlite_master WHERE type='table'\").fetchone()[0]; print(r); c.close()" 2>/dev/null || echo "0")"
if [[ "$table_count" -ge 2 ]]; then
  pass "Dashboard DB has $table_count tables"
else
  fail "Dashboard DB has $table_count tables (expected >= 2)"
fi

# Check host-side bind mounts exist
for dir in config backups dashboard-data; do
  if [[ -d "$PROJECT_ROOT/$dir" ]]; then
    pass "Host directory ./$dir/ exists"
  else
    fail "Host directory ./$dir/ is missing"
  fi
done

# Check dashboard-data is writable
if touch "$PROJECT_ROOT/dashboard-data/.smoke-test" 2>/dev/null; then
  rm -f "$PROJECT_ROOT/dashboard-data/.smoke-test"
  pass "dashboard-data/ is writable"
else
  fail "dashboard-data/ is not writable (will lose data on rebuild)"
fi

# ---------------------------------------------------------------------------
# 5. Critical Config Validation
# ---------------------------------------------------------------------------
section "Configuration"

# .env file exists
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  pass ".env file exists"
else
  fail ".env file is missing"
fi

# Check critical env vars are set
for var in DUNE_ADMIN_TOKEN POSTGRES_DUNE_PASSWORD DUNE_IMAGE_TAG; do
  val="${!var:-}"
  if [[ -n "$val" ]]; then
    pass "$var is set"
  else
    fail "$var is not set"
  fi
done

# ---------------------------------------------------------------------------
# 6. Database Connectivity (game DB)
# ---------------------------------------------------------------------------
section "Database Connectivity"

pg_status="$(docker exec dune-awakening-postgres-1 \
  pg_isready -U dune 2>/dev/null || echo "fail")"
if echo "$pg_status" | grep -q "accepting"; then
  pass "PostgreSQL is accepting connections"
else
  fail "PostgreSQL is not ready: $pg_status"
fi

# ---------------------------------------------------------------------------
# 7. Error Log Scan (last 100 lines)
# ---------------------------------------------------------------------------
section "Recent Error Scan"

api_errors="$(docker logs dune-awakening-dashboard-api-1 --tail 100 2>&1 | \
  grep -ciE 'error|traceback|exception|critical' || true)"
if [[ "$api_errors" -le 2 ]]; then
  pass "Dashboard API: $api_errors errors in last 100 log lines"
else
  warn "Dashboard API: $api_errors errors in last 100 log lines"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
section "Summary"
printf '  Passed: \033[32m%d\033[0m  Failed: \033[31m%d\033[0m  Warnings: \033[33m%d\033[0m\n\n' "$PASS" "$FAIL" "$WARN"

if [[ "$FAIL" -gt 0 ]]; then
  printf '\033[31mSmoke test FAILED with %d issue(s). Review above.\033[0m\n' "$FAIL"
  exit 1
fi

if [[ "$WARN" -gt 0 ]]; then
  printf '\033[33mSmoke test passed with %d warning(s).\033[0m\n' "$WARN"
else
  printf '\033[32mAll smoke tests passed.\033[0m\n'
fi
