#!/usr/bin/env bash
set -euo pipefail

NIC_IFACE="${NIC_IFACE:-enp86s0}"
TXRX_PATTERN="${TXRX_PATTERN:-${NIC_IFACE}-TxRx-}"
CPU_A="${NIC_IRQ_CPU_A:-10}"
CPU_B="${NIC_IRQ_CPU_B:-11}"
RETRY_DELAY_SECONDS="${NIC_IRQ_RETRY_DELAY_SECONDS:-2}"
MAX_ATTEMPTS="${NIC_IRQ_MAX_ATTEMPTS:-20}"

mask_for_cpu() {
  local cpu="$1"
  printf '0x%X\n' "$((1 << cpu))"
}

disable_irqbalance_if_present() {
  if [[ "${DISABLE_IRQBALANCE:-1}" == "0" ]]; then
    return 0
  fi
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl list-unit-files irqbalance.service >/dev/null 2>&1; then
      systemctl disable --now irqbalance.service >/dev/null 2>&1 || true
      echo "[nic-irq] irqbalance disabled"
    fi
  fi
}

find_txrx_irqs() {
  local -n out_ref=$1
  local attempt=1
  while (( attempt <= MAX_ATTEMPTS )); do
    mapfile -t out_ref < <(grep -E "$TXRX_PATTERN" /proc/interrupts 2>/dev/null | awk -F: '{print $1}' | tr -d ' ' | sed '/^$/d' || true)
    if ((${#out_ref[@]} > 0)); then
      return 0
    fi
    echo "[nic-irq] waiting for ${NIC_IFACE} TxRx IRQs (attempt ${attempt}/${MAX_ATTEMPTS})"
    sleep "$RETRY_DELAY_SECONDS"
    attempt=$((attempt + 1))
  done
  return 1
}

pin_irq() {
  local irq="$1"
  local affinity="$2"
  local attempt=1
  while (( attempt <= MAX_ATTEMPTS )); do
    if [[ -f "/proc/irq/${irq}/smp_affinity" ]]; then
      if echo "$affinity" > "/proc/irq/${irq}/smp_affinity" 2>/dev/null; then
        echo "[nic-irq] pinned IRQ ${irq} -> ${affinity}"
        return 0
      fi
    fi
    echo "[nic-irq] retrying IRQ ${irq} pinning (attempt ${attempt}/${MAX_ATTEMPTS})"
    sleep "$RETRY_DELAY_SECONDS"
    attempt=$((attempt + 1))
  done
  echo "[nic-irq] ERROR: failed to pin IRQ ${irq}" >&2
  return 1
}

disable_irqbalance_if_present

irqs=()
if ! find_txrx_irqs irqs; then
  echo "[nic-irq] ERROR: no TxRx IRQs found for ${NIC_IFACE}" >&2
  exit 1
fi

for idx in "${!irqs[@]}"; do
  irq="${irqs[$idx]}"
  if (( idx % 2 == 0 )); then
    affinity="$(mask_for_cpu "$CPU_A")"
  else
    affinity="$(mask_for_cpu "$CPU_B")"
  fi
  pin_irq "$irq" "$affinity"
done

echo "[nic-irq] pinned ${#irqs[@]} TxRx IRQs for ${NIC_IFACE} to CPUs ${CPU_A}-${CPU_B}"
