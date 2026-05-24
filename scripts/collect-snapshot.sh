#!/usr/bin/env bash
# collect-snapshot.sh - Collect a diagnostic snapshot for support/troubleshooting
#
# Gathers system info, container state, logs, config, and database status
# into a single tarball. All credentials are automatically redacted.
#
# Usage: ./scripts/collect-snapshot.sh [--tail 200]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

LOG_TAIL="${1:-200}"
if [[ "${1:-}" == "--tail" ]]; then
  LOG_TAIL="${2:-200}"
fi

SNAPSHOT_DIR="$(mktemp -d)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
SNAPSHOT_NAME="dune-snapshot-${TIMESTAMP}"
OUTPUT_DIR="${SNAPSHOT_DIR}/${SNAPSHOT_NAME}"
mkdir -p "$OUTPUT_DIR"

log_step "Collecting diagnostic snapshot..."

# ---------------------------------------------------------------------------
# Credential redaction
# ---------------------------------------------------------------------------
redact() {
  sed -E \
    -e 's/(password|PASSWORD|secret|SECRET|token|TOKEN|DUNE_ADMIN_TOKEN|FLS_SECRET)[=:][[:space:]]*.*/\1=<REDACTED>/gi' \
    -e 's/postgresql:\/\/[^@]+@/postgresql:\/\/<REDACTED>@/g' \
    -e 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/<JWT_REDACTED>/g' \
    -e 's/change-me-[a-zA-Z0-9_-]+/<REDACTED>/g'
}

# ---------------------------------------------------------------------------
# 1. System info
# ---------------------------------------------------------------------------
log_step "System information"
{
  echo "=== OS ==="
  uname -a
  echo ""
  cat /etc/os-release 2>/dev/null || echo "(os-release not available)"
  echo ""
  echo "=== CPU ==="
  lscpu 2>/dev/null | head -20 || nproc
  echo ""
  echo "=== Memory ==="
  free -h
  echo ""
  echo "=== Swap ==="
  swapon --show 2>/dev/null || echo "(no swap)"
  echo ""
  echo "=== Disk ==="
  df -h / 2>/dev/null
  echo ""
  echo "=== Docker version ==="
  docker version 2>/dev/null || echo "(docker not available)"
  echo ""
  echo "=== Docker Compose version ==="
  docker compose version 2>/dev/null || echo "(compose not available)"
} > "$OUTPUT_DIR/system-info.txt" 2>&1

# ---------------------------------------------------------------------------
# 2. Container state
# ---------------------------------------------------------------------------
log_step "Container state"
{
  echo "=== Running containers ==="
  docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | grep -i dune || echo "(no dune containers)"
  echo ""
  echo "=== All containers (including stopped) ==="
  docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}" 2>/dev/null | grep -i dune || echo "(no dune containers)"
  echo ""
  echo "=== Container resource usage ==="
  docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}" 2>/dev/null | grep -i dune || echo "(unavailable)"
} > "$OUTPUT_DIR/containers.txt" 2>&1

# ---------------------------------------------------------------------------
# 3. Container logs (tail)
# ---------------------------------------------------------------------------
log_step "Container logs (last $LOG_TAIL lines each)"
mkdir -p "$OUTPUT_DIR/logs"

for container in $(docker ps --format '{{.Names}}' 2>/dev/null | grep -i dune || true); do
  docker logs --tail "$LOG_TAIL" "$container" 2>&1 | redact > "$OUTPUT_DIR/logs/${container}.log" || true
done

# ---------------------------------------------------------------------------
# 4. Docker Compose config (redacted)
# ---------------------------------------------------------------------------
log_step "Compose configuration"
if [[ -f "$PROJECT_ROOT/docker-compose.yml" ]]; then
  cat "$PROJECT_ROOT/docker-compose.yml" | redact > "$OUTPUT_DIR/docker-compose.yml"
fi
if [[ -f "$PROJECT_ROOT/docker-compose.basic.yml" ]]; then
  cat "$PROJECT_ROOT/docker-compose.basic.yml" | redact > "$OUTPUT_DIR/docker-compose.basic.yml"
fi

# ---------------------------------------------------------------------------
# 5. Environment (redacted)
# ---------------------------------------------------------------------------
log_step "Environment variables"
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  cat "$PROJECT_ROOT/.env" | redact > "$OUTPUT_DIR/env-redacted.txt"
else
  echo "(no .env file)" > "$OUTPUT_DIR/env-redacted.txt"
fi

# ---------------------------------------------------------------------------
# 6. Sysctl settings
# ---------------------------------------------------------------------------
log_step "Kernel tuning"
{
  echo "=== VM settings ==="
  sysctl vm.swappiness vm.overcommit_memory vm.dirty_ratio vm.dirty_background_ratio 2>/dev/null || true
  echo ""
  echo "=== Network buffers ==="
  sysctl net.core.rmem_max net.core.wmem_max net.core.somaxconn 2>/dev/null || true
  echo ""
  echo "=== Transparent hugepages ==="
  cat /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || echo "(not available)"
  echo ""
  echo "=== Custom sysctl ==="
  cat /etc/sysctl.d/99-dune-server.conf 2>/dev/null || echo "(no dune sysctl config)"
} > "$OUTPUT_DIR/kernel-tuning.txt" 2>&1

# ---------------------------------------------------------------------------
# 7. Docker daemon config
# ---------------------------------------------------------------------------
log_step "Docker daemon config"
if [[ -f /etc/docker/daemon.json ]]; then
  cat /etc/docker/daemon.json | redact > "$OUTPUT_DIR/docker-daemon.json"
else
  echo "(no daemon.json)" > "$OUTPUT_DIR/docker-daemon.json"
fi

# ---------------------------------------------------------------------------
# 8. Database health check
# ---------------------------------------------------------------------------
log_step "Database status"
{
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'postgres'; then
    pg_container=$(docker ps --format '{{.Names}}' | grep -i dune | grep -i postgres | head -1)
    if [[ -n "$pg_container" ]]; then
      echo "=== Database size ==="
      docker exec "$pg_container" psql -U dune -d dune -c "SELECT pg_size_pretty(pg_database_size('dune'));" 2>/dev/null || echo "(query failed)"
      echo ""
      echo "=== Active connections ==="
      docker exec "$pg_container" psql -U dune -d dune -c "SELECT count(*) AS active_connections FROM pg_stat_activity WHERE state = 'active';" 2>/dev/null || echo "(query failed)"
      echo ""
      echo "=== Farm state ==="
      docker exec "$pg_container" psql -U dune -d dune -c "SELECT server_id, map, alive, game_addr, game_port FROM dune.farm_state;" 2>/dev/null | redact || echo "(query failed)"
    fi
  else
    echo "(postgres container not running)"
  fi
} > "$OUTPUT_DIR/database-status.txt" 2>&1

# ---------------------------------------------------------------------------
# 9. Network connectivity
# ---------------------------------------------------------------------------
log_step "Network status"
{
  echo "=== Listening ports ==="
  ss -tlnp 2>/dev/null | grep -E '(7777|7778|7888|7889|18080|31982|31983|5432|5672|15672)' || echo "(none found)"
  echo ""
  echo "=== External IP ==="
  curl -fsS --connect-timeout 5 https://api.ipify.org 2>/dev/null || echo "(detection failed)"
  echo ""
} > "$OUTPUT_DIR/network-status.txt" 2>&1

# ---------------------------------------------------------------------------
# 10. Dashboard health
# ---------------------------------------------------------------------------
log_step "Dashboard health"
{
  echo "=== API health ==="
  curl -fsS --connect-timeout 5 http://localhost:18080/api/health 2>/dev/null || echo "(API unreachable)"
  echo ""
  echo ""
  echo "=== API status ==="
  curl -fsS --connect-timeout 5 http://localhost:18080/api/status 2>/dev/null | redact || echo "(status unreachable)"
  echo ""
} > "$OUTPUT_DIR/dashboard-health.txt" 2>&1

# ---------------------------------------------------------------------------
# Package it up
# ---------------------------------------------------------------------------
ARCHIVE="${PROJECT_ROOT}/dune-snapshot-${TIMESTAMP}.tar.gz"
tar -czf "$ARCHIVE" -C "$SNAPSHOT_DIR" "$SNAPSHOT_NAME"
rm -rf "$SNAPSHOT_DIR"

log_success "Snapshot saved to: $ARCHIVE"
echo ""
echo "Contents:"
tar -tzf "$ARCHIVE" | head -30
echo "..."
echo ""
echo "Share this file when requesting support. All credentials have been redacted."
