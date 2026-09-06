#!/usr/bin/env bash
# Fail if game-server compose files or UserEngine.ini drop the net-rate flags
# that stop S2S NumOutRec 2047 overflows and player ack-window rubberbanding.
# Wired into CI and preflight so a silent revert cannot ship.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail=0

check_counts() {
  local file="$1"
  local timeouts igw ip inet
  timeouts="$(grep -c 'IgwNetDriver]:ConnectionTimeout=604800.0' "$file" || true)"
  igw="$(grep -c 'IgwNetDriver]:MaxClientRate=0' "$file" || true)"
  ip="$(grep -c 'IpNetDriver]:MaxClientRate=100000' "$file" || true)"
  inet="$(grep -c 'IpNetDriver]:MaxInternetClientRate=100000' "$file" || true)"
  if [[ "$timeouts" -eq 0 ]]; then
    echo "assert-net-rate-flags: $file has no IgwNetDriver ConnectionTimeout=604800.0"
    fail=1
    return
  fi
  if [[ "$igw" -ne "$timeouts" ]]; then
    echo "assert-net-rate-flags: $file IgwNetDriver MaxClientRate=0 count $igw != ConnectionTimeout $timeouts"
    fail=1
  fi
  if [[ "$ip" -ne "$timeouts" ]]; then
    echo "assert-net-rate-flags: $file IpNetDriver MaxClientRate=100000 count $ip != ConnectionTimeout $timeouts"
    fail=1
  fi
  if [[ "$inet" -ne "$timeouts" ]]; then
    echo "assert-net-rate-flags: $file IpNetDriver MaxInternetClientRate=100000 count $inet != ConnectionTimeout $timeouts"
    fail=1
  fi
}

for f in docker-compose.basic.yml docker-compose.standard.yml docker-compose.standard-lean.yml docker-compose.full.yml; do
  check_counts "$f"
done

ini="config/UserEngine.ini"
if ! grep -qE '^MaxClientRate=100000$' "$ini"; then
  echo "assert-net-rate-flags: $ini missing MaxClientRate=100000"
  fail=1
fi
if ! grep -qE '^MaxInternetClientRate=100000$' "$ini"; then
  echo "assert-net-rate-flags: $ini missing MaxInternetClientRate=100000"
  fail=1
fi
if ! awk '
  $0 == "[/Script/InfiniteGameWorlds.IgwNetDriver]" {in_igw=1; next}
  /^\[/ {in_igw=0}
  in_igw && $0 == "MaxClientRate=0" {found=1}
  END {exit found ? 0 : 1}
' "$ini"; then
  echo "assert-net-rate-flags: $ini IgwNetDriver section missing MaxClientRate=0"
  fail=1
fi

# Unlimited player bandwidth floods initial replication (client error 324).
if grep -n 'IpNetDriver]:MaxClientRate=0' docker-compose*.yml; then
  echo "assert-net-rate-flags: IpNetDriver MaxClientRate=0 is forbidden (use 100000, not unlimited)"
  fail=1
fi

if ((fail)); then
  echo "assert-net-rate-flags: FAILED"
  exit 1
fi
echo "assert-net-rate-flags: OK"
