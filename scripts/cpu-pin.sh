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
# CPU sets are auto-detected from Linux CPU topology. Hybrid hosts prefer
# higher-frequency P-cores for player-facing maps; non-hybrid hosts reserve the
# first physical cores and put the rest in the background pool.
#
# FALLBACK ONLY: if detection fails, the legacy 6C/12T layout is used:
#   CPUSET_SURVIVAL=0,1,2,6,7,8   (shared by survival + deep_desert)
#   CPUSET_BACKGROUND=3,4,5,9,10,11
# Override CPUSET_* for unusual hardware or hand-tuned layouts.
#
# Usage:
#   ./scripts/cpu-pin.sh                 # apply pinning to running containers
#   ./scripts/cpu-pin.sh --dry-run       # show what would change, change nothing
#   ./scripts/cpu-pin.sh --measure       # report survival_1 game-thread sched delay
#   sudo ./scripts/cpu-pin.sh --install  # install a systemd unit+timer (persist)
#   CPUSET_SURVIVAL=0,1 ./scripts/cpu-pin.sh   # override a core set
#
set -euo pipefail

PROJECT="${COMPOSE_PROJECT_NAME:-dune-awakening}"
DRY_RUN=false
INSTALL=false
MEASURE=false
LIBRARY_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --install) INSTALL=true; shift ;;
    --measure) MEASURE=true; shift ;;
    --library-only) LIBRARY_ONLY=true; shift ;;
    --help|-h)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

join_csv() {
  local out='' item
  for item in "$@"; do
    [[ -n "$item" ]] || continue
    if [[ -n "$out" ]]; then
      out="${out},${item}"
    else
      out="$item"
    fi
  done
  printf '%s\n' "$out"
}

append_csv() {
  local base="$1" add="$2"
  if [[ -n "$base" && -n "$add" ]]; then
    printf '%s,%s\n' "$base" "$add"
  else
    printf '%s%s\n' "$base" "$add"
  fi
}

all_online_cpus() {
  local cpu_dir cpu online cpus=()
  for cpu_dir in /sys/devices/system/cpu/cpu[0-9]*; do
    [[ -d "$cpu_dir" ]] || continue
    cpu="${cpu_dir##*cpu}"
    online="$(cat "$cpu_dir/online" 2>/dev/null || printf '1')"
    [[ "$online" == '1' ]] && cpus+=("$cpu")
  done
  ((${#cpus[@]} > 0)) || return 1
  join_csv "${cpus[@]}"
}

detect_cpuset_defaults() {
  local fallback_survival='0,1,2,6,7,8'
  local fallback_background='3,4,5,9,10,11'
  local cpu_dir cpu online pkg core key freq
  local -A core_cpus=()
  local -A core_freq=()
  local -a records=()
  local record cpus

  for cpu_dir in /sys/devices/system/cpu/cpu[0-9]*; do
    [[ -d "$cpu_dir" ]] || continue
    cpu="${cpu_dir##*cpu}"
    online="$(cat "$cpu_dir/online" 2>/dev/null || printf '1')"
    [[ "$online" == '1' ]] || continue
    pkg="$(cat "$cpu_dir/topology/physical_package_id" 2>/dev/null || printf '0')"
    core="$(cat "$cpu_dir/topology/core_id" 2>/dev/null || printf '%s' "$cpu")"
    key="${pkg}:${core}"
    freq="$(cat "$cpu_dir/cpufreq/cpuinfo_max_freq" 2>/dev/null || printf '0')"
    core_cpus[$key]="$(append_csv "${core_cpus[$key]:-}" "$cpu")"
    if [[ -z "${core_freq[$key]:-}" || "$freq" -gt "${core_freq[$key]}" ]]; then
      core_freq[$key]="$freq"
    fi
  done

  if ((${#core_cpus[@]} == 0)); then
    DETECTED_CPUSET_SURVIVAL="$fallback_survival"
    DETECTED_CPUSET_DEEP_DESERT="$fallback_survival"
    DETECTED_CPUSET_BACKGROUND="$fallback_background"
    return 0
  fi

  mapfile -t records < <(
    for key in "${!core_cpus[@]}"; do
      printf '%012d %s %s\n' "${core_freq[$key]:-0}" "$key" "${core_cpus[$key]}"
    done | sort -k1,1nr -k2,2V
  )

  DETECTED_CPUSET_SURVIVAL=''
  DETECTED_CPUSET_BACKGROUND=''

  # On hybrid CPUs (Intel 12th-gen+), all high-frequency P-cores go to the
  # shared player-facing pool (used by both survival_1 and deep_desert_1).
  # Lower-frequency E-cores form the background pool for hubs and infra.
  #
  # The old layout gave deep_desert only 1 physical core (2 logical CPUs),
  # causing catastrophic game-thread starvation: UE5 spawns ~52 threads per
  # server but only 2 CPUs were available, producing 5-22 second tick stalls
  # and severe rubberbanding.
  #
  # Boundary: any core whose max frequency >= 80% of the fastest core is
  # classified as a P-core. On non-hybrid CPUs all cores share a pool.
  local top_freq=0
  if ((${#records[@]} > 0)); then
    top_freq="${records[0]%% *}"
    top_freq=$((10#$top_freq))
  fi
  local threshold=$(( top_freq * 80 / 100 ))

  for record in "${records[@]}"; do
    local freq="${record%% *}"
    freq=$((10#$freq))
    cpus="${record#* * }"
    if ((top_freq > 0 && freq >= threshold)); then
      DETECTED_CPUSET_SURVIVAL="$(append_csv "$DETECTED_CPUSET_SURVIVAL" "$cpus")"
    else
      DETECTED_CPUSET_BACKGROUND="$(append_csv "$DETECTED_CPUSET_BACKGROUND" "$cpus")"
    fi
  done

  # Both player-facing maps share the same P-core pool
  DETECTED_CPUSET_DEEP_DESERT="$DETECTED_CPUSET_SURVIVAL"

  DETECTED_CPUSET_SURVIVAL="${DETECTED_CPUSET_SURVIVAL:-$(all_online_cpus || printf '%s' "$fallback_survival")}"
  DETECTED_CPUSET_DEEP_DESERT="$DETECTED_CPUSET_SURVIVAL"
  DETECTED_CPUSET_BACKGROUND="${DETECTED_CPUSET_BACKGROUND:-$(all_online_cpus || printf '%s' "$fallback_background")}"
}

detect_primary_nic() {
  local iface carrier
  if [[ -n "${NIC_DEVICE:-}" ]]; then
    printf '%s\n' "$NIC_DEVICE"
    return 0
  fi
  for iface in /sys/class/net/*; do
    [[ -d "$iface" ]] || continue
    iface="${iface##*/}"
    [[ "$iface" == 'lo' ]] && continue
    carrier="$(cat "/sys/class/net/${iface}/carrier" 2>/dev/null || printf '0')"
    if [[ "$carrier" == '1' ]]; then
      printf '%s\n' "$iface"
      return 0
    fi
  done
  if command -v ip >/dev/null 2>&1; then
    ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}' || true
  fi
}

detect_cpuset_defaults
CPUSET_SURVIVAL="${CPUSET_SURVIVAL:-$DETECTED_CPUSET_SURVIVAL}"           # player-facing: all P-cores (shared by survival + deep_desert)
CPUSET_DEEP_DESERT="${CPUSET_DEEP_DESERT:-$DETECTED_CPUSET_DEEP_DESERT}" # shares survival pool (was 1 core — caused tick stalls)
CPUSET_BACKGROUND="${CPUSET_BACKGROUND:-$DETECTED_CPUSET_BACKGROUND}"     # hubs + infra: E-cores

cpuset_for() {
  case "$1" in
    survival_1)    echo "$CPUSET_SURVIVAL" ;;
    deep_desert_1) echo "$CPUSET_DEEP_DESERT" ;;
    *)             echo "$CPUSET_BACKGROUND" ;;
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
  # Auto-detect the first non-loopback interface with carrier; fall back to the
  # default-route NIC, then legacy eno2 only if Linux exposes neither signal.
  local nic
  nic="$(detect_primary_nic)"
  nic="${nic:-eno2}"

  local irq cur irqs
  irqs="$(grep "$nic" /proc/interrupts 2>/dev/null | awk -F: '{print $1}' | tr -d ' ' || true)"
  for irq in $irqs; do
    cur="$(cat "/proc/irq/${irq}/smp_affinity_list" 2>/dev/null || echo '')"
    if [[ "$cur" != "$CPUSET_BACKGROUND" ]]; then
      if $DRY_RUN; then
        echo "would pin IRQ ${irq} ($nic) -> background pool ${CPUSET_BACKGROUND} (currently ${cur})"
      else
        echo "$CPUSET_BACKGROUND" > "/proc/irq/${irq}/smp_affinity_list" 2>/dev/null \
          && echo "pinned IRQ ${irq} ($nic) -> background pool" \
          || echo "FAILED to pin IRQ ${irq} (need root?)" >&2
      fi
    fi
  done
}

if $LIBRARY_ONLY || [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0 2>/dev/null || exit 0
fi

if $MEASURE; then
  measure_sched_delay
elif $INSTALL; then
  install_systemd
else
  apply_pinning
  pin_nic_irqs
fi
