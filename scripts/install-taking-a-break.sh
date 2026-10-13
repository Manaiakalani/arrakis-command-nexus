#!/usr/bin/env bash
# Install the host helper that the dashboard "Taking a break" button calls.
# Run on the Dune host: sudo ./scripts/install-taking-a-break.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA="$ROOT/dashboard-data"
OFFSITE="${DUNE_OFFSITE_BACKUP:-/home/dunebrah/bin/daspicebox-backup.sh}"
HOST_SCRIPT="$ROOT/scripts/taking-a-break-host.sh"

chmod 755 "$HOST_SCRIPT" "$ROOT/scripts/taking_a_break_validate.py"
mkdir -p "$DATA"
rm -f "$DATA/taking-a-break.request"

cat > /etc/systemd/system/daspicebox-break.service <<EOF
[Unit]
Description=Offsite backup and power off for Taking a break
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$HOST_SCRIPT
TimeoutStartSec=1800
Nice=10
EOF

if [[ -f /etc/systemd/system/ntfy-on-failure@.service ]]; then
  mkdir -p /etc/systemd/system/daspicebox-break.service.d
  cat > /etc/systemd/system/daspicebox-break.service.d/ntfy.conf <<'EOF'
[Unit]
OnFailure=ntfy-on-failure@%n.service
EOF
fi

cat > /etc/systemd/system/daspicebox-break.path <<EOF
[Unit]
Description=Watch for a Taking a break request from the dashboard

[Path]
PathExists=$DATA/taking-a-break.request
Unit=daspicebox-break.service

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
systemctl enable --now daspicebox-break.path
systemctl reset-failed daspicebox-break.service || true
echo "Taking a break helper installed. Path unit: $(systemctl is-enabled daspicebox-break.path)"
