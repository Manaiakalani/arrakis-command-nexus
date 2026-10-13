#!/usr/bin/env bash
# Install the host helper that the dashboard "Taking a break" button calls.
# The offsite script path stays on this machine. It is not stored in git.
#   sudo DUNE_OFFSITE_BACKUP=/usr/local/sbin/dune-offsite-backup.sh ./scripts/install-taking-a-break.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA="$ROOT/dashboard-data"
OFFSITE="${DUNE_OFFSITE_BACKUP:-}"
UNIT="${DUNE_BREAK_UNIT:-dune-taking-a-break}"
RUN="${DUNE_BREAK_RUN:-/run/dune-taking-a-break}"
HOST_SCRIPT="$ROOT/scripts/taking-a-break-host.sh"

if [[ ! "$OFFSITE" =~ ^/[-A-Za-z0-9._/]+$ || ! -x "$OFFSITE" ]]; then
  echo "Set DUNE_OFFSITE_BACKUP to an executable absolute path with no spaces." >&2
  exit 1
fi
if [[ ! "$UNIT" =~ ^[A-Za-z0-9][A-Za-z0-9:_.@-]{0,200}$ ]]; then
  echo "DUNE_BREAK_UNIT is not a safe systemd unit name." >&2
  exit 1
fi
if [[ ! "$RUN" =~ ^/[-A-Za-z0-9._/]+$ ]]; then
  echo "DUNE_BREAK_RUN must be an absolute path with no spaces." >&2
  exit 1
fi

chmod 755 "$HOST_SCRIPT" "$ROOT/scripts/taking_a_break_validate.py"
mkdir -p "$DATA"
rm -f "$DATA/taking-a-break.request"

cat > "/etc/systemd/system/${UNIT}.service" <<EOF
[Unit]
Description=Offsite backup and power off for Taking a break
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=DUNE_OFFSITE_BACKUP=$OFFSITE
Environment=DUNE_BREAK_RUN=$RUN
Environment=DUNE_BREAK_ROOT=$ROOT
Environment=DUNE_BREAK_DATA=$DATA
ExecStart=$HOST_SCRIPT
TimeoutStartSec=1800
Nice=10
EOF

if [[ -f /etc/systemd/system/ntfy-on-failure@.service ]]; then
  mkdir -p "/etc/systemd/system/${UNIT}.service.d"
  cat > "/etc/systemd/system/${UNIT}.service.d/ntfy.conf" <<'EOF'
[Unit]
OnFailure=ntfy-on-failure@%n.service
EOF
fi

cat > "/etc/systemd/system/${UNIT}.path" <<EOF
[Unit]
Description=Watch for a Taking a break request from the dashboard

[Path]
PathExists=$DATA/taking-a-break.request
Unit=${UNIT}.service

[Install]
WantedBy=multi-user.target
EOF

python3 - "$DATA/taking-a-break.helper" "$OFFSITE" <<'PY'
import json, os, sys
path, offsite = sys.argv[1:]
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump({"installed": True, "offsite": offsite}, fh)
os.replace(tmp, path)
os.chmod(path, 0o644)
PY

systemctl daemon-reload
systemctl enable --now "${UNIT}.path"
systemctl reset-failed "${UNIT}.service" || true
echo "Taking a break helper installed. Path unit: $(systemctl is-enabled "${UNIT}.path")"
