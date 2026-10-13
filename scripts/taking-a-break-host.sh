#!/usr/bin/env bash
# Offsite backup, then power off, for the dashboard "Taking a break" control.
#
# The dashboard writes dashboard-data/taking-a-break.request only after the
# in-game warning and the local backup have succeeded. This script must run
# while Postgres is still up. It refuses to power off if the offsite copy fails.
#
# The request file is moved off the watched path immediately so a reboot cannot
# run this again. Docker volumes are not deleted. dune-stack.service stops the
# stack, including Postgres, as the host powers off.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${DUNE_BREAK_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DATA="${DUNE_BREAK_DATA:-$ROOT/dashboard-data}"
REQ="$DATA/taking-a-break.request"
RESULT="$DATA/taking-a-break.result"
OFFSITE="${DUNE_OFFSITE_BACKUP:-/home/dunebrah/bin/daspicebox-backup.sh}"
MAX_AGE="${DUNE_BREAK_MAX_AGE_SECONDS:-900}"
STAGE="${DUNE_BREAK_RUN:-/run/daspicebox}"
VALIDATOR="$SCRIPT_DIR/taking_a_break_validate.py"

write_result() {
  local status="$1"
  local message="$2"
  python3 - "$RESULT" "$status" "$message" <<'PY'
import json, os, sys
from datetime import datetime, timezone
path, status, message = sys.argv[1:]
parent = os.path.dirname(path)
os.makedirs(parent, exist_ok=True)
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(
        {"status": status, "message": message, "at": datetime.now(timezone.utc).isoformat()},
        fh,
    )
os.replace(tmp, path)
PY
}

fail() {
  write_result error "$1"
  rm -f "$REQ"
  logger -t taking-a-break -- "$1" || true
  exit 1
}

if [[ ! -f "$REQ" ]]; then
  exit 0
fi

if ! python3 "$VALIDATOR" "$REQ" "$MAX_AGE"; then
  rm -f "$REQ"
  write_result error "Ignored a stale or invalid break request. The NUC stayed on."
  exit 1
fi

mkdir -p "$STAGE"
mv "$REQ" "$STAGE/taking-a-break.request"
write_result ack "Host helper started. Copying the world to cudachu."

if [[ ! -x "$OFFSITE" ]]; then
  fail "Offsite backup script is missing. The NUC stayed on."
fi

if ! "$OFFSITE"; then
  fail "Offsite backup failed. The NUC stayed on."
fi

write_result powering_off "Offsite copy finished. Powering off."
sync
if [[ -n "${DUNE_BREAK_SHUTDOWN_CMD:-}" ]]; then
  bash -c "$DUNE_BREAK_SHUTDOWN_CMD"
else
  systemctl --no-block poweroff
fi
