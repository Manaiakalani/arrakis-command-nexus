#!/usr/bin/env bash
# cpu-pin.sh - Pin Dune Awakening containers to dedicated CPU cores
#
# Why: each map server is a separate single-thread-bound UE5 simulation. On a
# host with few physical cores, running many maps (the standard/full profiles)
# lets the other servers' threads preempt the main world's game thread mid-tick.
# The 30 Hz tick then misses its deadline and movement replication snaps the
# player back - in-game rubberbanding - even though average CPU/RAM look fine.
# Average load and `vmstat` cannot see these sub-tick (10-50 ms) scheduling
# stalls; only per-thread run-queue latency does (see --measure).
#
# Fix: give the player-facing maps their own physical cores and confine the
# other servers + infrastructure to a shared pool, so the active world's game
# thread always has a free core. This does NOT change any game/travel/IGW
# config and is fully reversible (`docker update --cpuset-cpus "" <container>`).
#
# The defaults below target a 6 physical core / 12 thread host (Intel HT sibling
# pairs 0-5 / 6-11). Override the three CPUSET_* variables for other topologies;
# inspect your layout with `lscpu -e=CPU,CORE` first.
#
# Usage:
#   ./scripts/cpu-pin.sh                 # apply pinning to running containers
#   ./scripts/cpu-pin.sh --dry-run       # show what would change, change nothing
#   ./scripts/cpu-pin.sh --measure       # report survival_1 game-thread sched delay
#   sudo ./scripts/cpu-pin.sh --install  # install a systemd unit+timer (persist)
#   CPUSET_SURVIVAL=0,1 ./scripts/cpu-pin.sh   # override a core set
#
set -euo pipefail

# --- core assignment (override via environment for other hardware) -----------
CPUSET_SURVIVAL="${CPUSET_SURVIVAL:-0,1,6,7}"      # main world: 2 dedicated cores
CPUSET_DEEP_DESERT="${CPUSET_DEEP_DESERT:-2,8}"     # heavy destination: 1 core (expand if players join)
CPUSET_BACKGROUND="${CPUSET_BACKGROUND:-3,4,5,9,10,11}" # hubs + infra: 3 physical cores

PROJECT="${COMPOSE_PROJECT_NAME:-dune-awakening}"
DRY_RUN=false
INSTALL=false
MEASURE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --install) INSTALL=true; shift ;;
    --measure) MEASURE=true; shift ;;
    --help|-h)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

cpuset_for() {
  case "$1" in
    survival_1)     echo "$CPUSET_SURVIVAL" ;;
    deep_desert_1)  echo "$CPUSET_DEEP_DESERT" ;;
    *)              echo "$CPUSET_BACKGROUND" ;;
  esac
}

apply_pinning() {
  local changed=0 c svc want cur
  for c in $(docker ps --format '{{.Names}}' 2>/dev/null | grep "^${PROJECT}-" || true); do
    svc="$(echo "$c" | sed -E "s/^${PROJECT}-//; s/-[0-9]+$//")"
    want="$(cpuset_for "$svc")"
    cur="$(docker inspect -f '{{.HostConfig.CpusetCpus}}' "$c" 2>/dev/null || echo '')"
    if [[ "$cur" == "$want" ]]; then
      continue
    fi
    if $DRY_RUN; then
      echo "would pin ${svc} -> ${want} (currently '${cur:-all}')"
    else
      if docker update --cpuset-cpus "$want" "$c" >/dev/null 2>&1; then
        echo "pinned ${svc} -> ${want} (was '${cur:-all}')"
        changed=$((changed + 1))
      else
        echo "FAILED to pin ${svc}" >&2
      fi
    fi
  done
  $DRY_RUN || echo "cpu-pin: ${changed} container(s) updated"
}

# Report the survival_1 game-thread (UE5 main thread) run-queue wait over 15 s.
# A healthy pinned thread sits near or below ~2%; double-digit percentages mean
# the game thread is being preempted and the player will rubberband.
measure_sched_delay() {
  command -v python3 >/dev/null 2>&1 || { echo "python3 required for --measure" >&2; exit 1; }
  if [[ "$(cat /proc/sys/kernel/sched_schedstats 2>/dev/null || echo 0)" != "1" ]]; then
    echo "note: kernel.sched_schedstats is off; enable with: sudo sysctl -w kernel.sched_schedstats=1" >&2
  fi
  local pid
  pid="$(docker top "${PROJECT}-survival_1-1" 2>/dev/null \
        | grep DuneSandboxServer-Linux-Shipping | grep -v '\.sh' | awk '{print $2}' | head -1)"
  [[ -n "${pid:-}" ]] || { echo "survival_1 UE process not found" >&2; exit 1; }
  echo "survival_1 UE pid ${pid}, Cpus_allowed: $(awk '/Cpus_allowed_list/{print $2}' "/proc/${pid}/status")"
  read -r r1 w1 _ < "/proc/${pid}/schedstat"; sleep 15; read -r r2 w2 _ < "/proc/${pid}/schedstat"
  echo "$r1 $r2 $w1 $w2" | python3 -c "import sys
a=list(map(float,sys.stdin.read().split())); run=(a[1]-a[0])/1e9; w=(a[3]-a[2])/1e9; tot=run+w
print(f'GameThread 15s: onCPU={run:.2f}s runqueue-WAIT={w*1000:.1f}ms sched-delay={(w/tot*100 if tot>0 else 0):.2f}%')"
}

install_systemd() {
  [[ "$(id -u)" -eq 0 ]] || { echo "--install must be run as root (sudo)" >&2; exit 1; }
  install -m 755 "$0" /usr/local/bin/dune-cpu-pin.sh
  cat > /etc/systemd/system/dune-cpu-pin.service <<UNIT
[Unit]
Description=Pin Dune Awakening containers to dedicated CPU cores (anti-rubberband)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
Environment=CPUSET_SURVIVAL=${CPUSET_SURVIVAL}
Environment=CPUSET_DEEP_DESERT=${CPUSET_DEEP_DESERT}
Environment=CPUSET_BACKGROUND=${CPUSET_BACKGROUND}
ExecStart=/usr/local/bin/dune-cpu-pin.sh
UNIT
  cat > /etc/systemd/system/dune-cpu-pin.timer <<'UNIT'
[Unit]
Description=Re-apply Dune CPU pinning on boot and periodically (self-heal recreates)

[Timer]
OnBootSec=60
OnUnitActiveSec=5min
Unit=dune-cpu-pin.service

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now dune-cpu-pin.timer
  systemctl start dune-cpu-pin.service
  echo "installed dune-cpu-pin.service + timer (re-applies on boot and every 5 min)"
}

# Pin NIC IRQs to the background pool so hardware interrupt processing never
# preempts the dedicated game-server cores. Without this, NIC RX queue
# interrupts can land on survival_1/deep_desert_1 cores and inject scheduling
# jitter invisible to UE5 logs.
pin_nic_irqs() {
  # Auto-detect the default route NIC if not specified
  local nic="${NIC_DEVICE:-$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}' | head -1)}"
  nic="${nic:-eno2}"

  # Compute hex affinity mask from CPUSET_BACKGROUND
  local mask=0
  local cpu
  for cpu in $(echo "$CPUSET_BACKGROUND" | tr ',' ' '); do
    mask=$((mask | (1 << cpu)))
  done
  local want_hex
  want_hex=$(printf '%08x' "$mask")

  local irq cur
  for irq in $(grep "$nic" /proc/interrupts 2>/dev/null | awk -F: '{print $1}' | tr -d ' '); do
    cur="$(cat "/proc/irq/${irq}/smp_affinity" 2>/dev/null || echo '')"
    if [[ "$cur" != "$want_hex" ]]; then
      if $DRY_RUN; then
        echo "would pin IRQ ${irq} ($nic) -> background pool 0x${want_hex} (currently ${cur})"
      else
        echo "$want_hex" > "/proc/irq/${irq}/smp_affinity" 2>/dev/null \
          && echo "pinned IRQ ${irq} ($nic) -> background pool" \
          || echo "FAILED to pin IRQ ${irq} (need root?)" >&2
      fi
    fi
  done
}

if $MEASURE; then
  measure_sched_delay
elif $INSTALL; then
  install_systemd
else
  apply_pinning
  pin_nic_irqs
fi
