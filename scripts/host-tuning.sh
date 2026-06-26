#!/usr/bin/env bash
# host-tuning.sh - Apply Linux kernel and Docker tuning for Dune Awakening servers
#
# Optimizes:
#   - VM memory (swappiness, overcommit, dirty ratios)
#   - Network buffers (UDP game traffic)
#   - Transparent hugepages (disabled for game workloads)
#   - Optional swap file creation for low-memory hosts
#   - Docker daemon log and storage settings
#
# Usage:
#   sudo ./host-tuning.sh              # Apply sysctl + Docker tuning
#   sudo ./host-tuning.sh --swap 8     # Also create an 8 GiB swap file
#   sudo ./host-tuning.sh --dry-run    # Show what would be changed

set -euo pipefail

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
DRY_RUN=false
SWAP_SIZE_GIB=0
RESERVE_HOST_MEM_GIB=2

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)      DRY_RUN=true; shift ;;
    --swap)         SWAP_SIZE_GIB="${2:-8}"; shift 2 ;;
    --reserve-mem)  RESERVE_HOST_MEM_GIB="${2:-2}"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--swap SIZE_GIB] [--reserve-mem GIB] [--dry-run]"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

log()  { printf '\033[1;34m[TUNE]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ OK ]\033[0m %s\n' "$*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  echo "This script must be run as root (sudo)." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Sysctl tuning
# ---------------------------------------------------------------------------
SYSCTL_CONF="/etc/sysctl.d/99-dune-server.conf"

SYSCTL_CONTENT="# Dune Awakening server host tuning
# Applied by dune-server-docker/scripts/host-tuning.sh

# --- Memory ---
# Lower swappiness: prefer keeping game server pages in RAM
vm.swappiness = 10
# Allow slight overcommit for container memory flexibility
vm.overcommit_memory = 1
# Flush dirty pages sooner to avoid I/O stalls during world saves
vm.dirty_ratio = 10
vm.dirty_background_ratio = 5

# --- Network (UDP game traffic) ---
# Increase UDP receive/send buffers for game server traffic.
# UE5's S2S inter-server sockets use rmem_default (not the per-socket override),
# so this must be large enough to absorb mesh traffic bursts without overflow.
net.core.rmem_max = 33554432
net.core.wmem_max = 33554432
net.core.rmem_default = 8388608
net.core.wmem_default = 4194304
# Increase connection backlog for burst player joins
net.core.somaxconn = 4096
net.core.netdev_max_backlog = 5000
# Increase softnet budget to reduce time_squeeze events on busy CPUs.
# Default 300 packets / 2000 us is too low when multiple game servers
# share a NIC; the kernel drops back to the poll loop before draining
# all pending packets, causing scheduling jitter on game-server cores.
net.core.netdev_budget = 600
net.core.netdev_budget_usecs = 4000

# --- General ---
# Increase max open files for containers with many connections
fs.file-max = 2097152
"

log "Sysctl tuning"
if $DRY_RUN; then
  echo "Would write to $SYSCTL_CONF:"
  echo "$SYSCTL_CONTENT"
else
  echo "$SYSCTL_CONTENT" > "$SYSCTL_CONF"
  sysctl --system > /dev/null 2>&1
  ok "Applied sysctl settings to $SYSCTL_CONF"
fi

# ---------------------------------------------------------------------------
# 2. Transparent hugepages
# ---------------------------------------------------------------------------
log "Transparent hugepages"
THP_PATH="/sys/kernel/mm/transparent_hugepage/enabled"

if [[ -f "$THP_PATH" ]]; then
  current_thp=$(cat "$THP_PATH")
  if echo "$current_thp" | grep -q '\[never\]'; then
    ok "Already disabled"
  elif $DRY_RUN; then
    echo "Would write 'never' to $THP_PATH"
  else
    echo never > "$THP_PATH"
    # Make persistent via rc.local or systemd
    if [[ ! -f /etc/rc.local ]] || ! grep -q 'transparent_hugepage' /etc/rc.local 2>/dev/null; then
      mkdir -p /etc/rc.local.d 2>/dev/null || true
      cat > /etc/rc.local.d/disable-thp.sh << 'THP_SCRIPT'
#!/bin/sh
echo never > /sys/kernel/mm/transparent_hugepage/enabled
echo never > /sys/kernel/mm/transparent_hugepage/defrag
THP_SCRIPT
      chmod +x /etc/rc.local.d/disable-thp.sh
    fi
    ok "Disabled transparent hugepages"
  fi
else
  warn "Transparent hugepages not available (containerized host?)"
fi

# ---------------------------------------------------------------------------
# 3. Swap file (optional)
# ---------------------------------------------------------------------------
if [[ "$SWAP_SIZE_GIB" -gt 0 ]]; then
  SWAPFILE="/swapfile"
  log "Swap file: ${SWAP_SIZE_GIB} GiB"

  if swapon --show | grep -q "$SWAPFILE"; then
    ok "Swap file already active"
  elif $DRY_RUN; then
    echo "Would create ${SWAP_SIZE_GIB} GiB swap at $SWAPFILE"
  else
    if [[ -f "$SWAPFILE" ]]; then
      swapoff "$SWAPFILE" 2>/dev/null || true
      rm -f "$SWAPFILE"
    fi
    dd if=/dev/zero of="$SWAPFILE" bs=1M count=$((SWAP_SIZE_GIB * 1024)) status=progress
    chmod 600 "$SWAPFILE"
    mkswap "$SWAPFILE"
    swapon "$SWAPFILE"

    # Persist in fstab
    if ! grep -q "$SWAPFILE" /etc/fstab; then
      echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab
    fi
    ok "Created and activated ${SWAP_SIZE_GIB} GiB swap"
  fi
fi

# ---------------------------------------------------------------------------
# 4. Docker daemon tuning
# ---------------------------------------------------------------------------
DOCKER_DAEMON_JSON="/etc/docker/daemon.json"
log "Docker daemon configuration"

DOCKER_CONF='{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Hard": 65536,
      "Soft": 65536
    }
  },
  "userland-proxy": false
}'

if $DRY_RUN; then
  echo "Would write to $DOCKER_DAEMON_JSON:"
  echo "$DOCKER_CONF"
else
  if [[ -f "$DOCKER_DAEMON_JSON" ]]; then
    cp "$DOCKER_DAEMON_JSON" "${DOCKER_DAEMON_JSON}.bak"
    warn "Backed up existing daemon.json to ${DOCKER_DAEMON_JSON}.bak"
  fi
  echo "$DOCKER_CONF" > "$DOCKER_DAEMON_JSON"
  ok "Wrote Docker daemon config"

  if systemctl is-active docker > /dev/null 2>&1; then
    warn "Docker is running. Restart it to apply: sudo systemctl restart docker"
    warn "WARNING: This will briefly stop all containers."
  fi
fi

# ---------------------------------------------------------------------------
# 5. Memory report
# ---------------------------------------------------------------------------
echo ""
log "Host memory report"
total_mem_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
total_mem_gb=$((total_mem_kb / 1024 / 1024))
avail_mem_kb=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
avail_mem_gb=$((avail_mem_kb / 1024 / 1024))
swap_total_kb=$(grep SwapTotal /proc/meminfo | awk '{print $2}')
swap_total_gb=$((swap_total_kb / 1024 / 1024))

echo "  Total RAM:       ${total_mem_gb} GiB"
echo "  Available RAM:   ${avail_mem_gb} GiB"
echo "  Swap:            ${swap_total_gb} GiB"
echo "  Host reserved:   ${RESERVE_HOST_MEM_GIB} GiB"
echo "  For containers:  $((total_mem_gb - RESERVE_HOST_MEM_GIB)) GiB"
echo ""

# Memory profile recommendations
container_mem=$((total_mem_gb + swap_total_gb - RESERVE_HOST_MEM_GIB))
if [[ $container_mem -ge 40 ]]; then
  echo "  Profile recommendation: full (all maps)"
elif [[ $container_mem -ge 30 ]]; then
  echo "  Profile recommendation: standard (Survival + Deep Desert + Story)"
elif [[ $container_mem -ge 18 ]]; then
  echo "  Profile recommendation: basic (Survival + Overmap)"
else
  warn "Low memory. Survival shard alone needs 12+ GiB. Consider adding swap (--swap 8)."
fi

# ---------------------------------------------------------------------------
# 6. Passwordless sudo for shutdown commands
# ---------------------------------------------------------------------------
# This allows the `dune shutdown-host` script to power off the host without
# interactive password prompts (required for unattended/dashboard-triggered shutdowns).
SUDOERS_FILE="/etc/sudoers.d/dune-shutdown"
CURRENT_USER="${SUDO_USER:-$USER}"

if [[ -n "$CURRENT_USER" && "$CURRENT_USER" != "root" ]]; then
  log "Configuring passwordless sudo for shutdown commands (user: $CURRENT_USER)"
  if $DRY_RUN; then
    echo "[dry-run] Would write: $SUDOERS_FILE"
  else
    cat > "$SUDOERS_FILE" << EOF
# Allow the Dune server operator to shut down/reboot without a password.
# Created by host-tuning.sh for unattended shutdown support.
$CURRENT_USER ALL=(ALL) NOPASSWD: /sbin/shutdown, /sbin/poweroff, /sbin/reboot, /usr/sbin/shutdown, /usr/sbin/poweroff, /usr/sbin/reboot
EOF
    chmod 440 "$SUDOERS_FILE"
    ok "Created $SUDOERS_FILE (passwordless shutdown for $CURRENT_USER)"
  fi
else
  warn "Could not determine non-root user; skipping sudoers setup."
fi

echo ""
ok "Host tuning complete. Review the output above for any warnings."
