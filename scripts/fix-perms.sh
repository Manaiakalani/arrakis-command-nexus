#!/usr/bin/env bash
# fix-perms.sh - One-shot chown of mounted writable dirs (and the .env
# file) to match the container user (uid 999 = app inside dashboard-api).
#
# Problem: docker-compose bind mounts preserve host ownership
# (typically uid 1000), but the dashboard-api container runs as uid 999
# with `cap_drop: ALL` so it cannot self-chown. Without this, the
# Game Settings page + /config raw editor cannot save (EACCES), and a
# tightly-permissioned .env (e.g. mode 600 from a secure copy during a
# host migration) makes /api/status fail to read WORLD_NAME (EACCES).
#
# Idempotent. Safe to run repeatedly. Uses a temporary root-privileged
# alpine container to avoid needing host-side sudo.
#
# Usage: ./dune fix-perms

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Writable bind-mount targets shared with dashboard-api:
DIRS=(config dashboard-data backups)

echo "[fix-perms] Chowning writable mount dirs to uid 999 (dashboard-api app user)..."
for d in "${DIRS[@]}"; do
  full="$PROJECT_ROOT/$d"
  if [ ! -d "$full" ]; then
    mkdir -p "$full"
    echo "[fix-perms] Created missing dir: $d/"
  fi
  docker run --rm -v "$full:/target" alpine:3.20 sh -c "chown -R 999:999 /target && chmod -R u+rwX,g+rwX /target" \
    || { echo "[fix-perms] Failed to chown $d/"; exit 1; }
  echo "[fix-perms]   $d/ -> uid 999 (group 999), mode u+rwX,g+rwX"
done

# .env is bind-mounted rw into dashboard-api for live reads/writes of
# WORLD_NAME, EXTERNAL_ADDRESS, and the server password. Unlike the data
# dirs it is host-user-managed config, so PRESERVE its owner and instead
# grant the container's group (999) read+write. Mode 660 keeps the secrets
# out of reach of other host users while still letting the owner edit it.
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  docker run --rm -v "$PROJECT_ROOT:/target" alpine:3.20 sh -c \
    'owner=$(stat -c %u /target/.env) && chown "${owner}:999" /target/.env && chmod 660 /target/.env' \
    || { echo "[fix-perms] Failed to adjust .env perms"; exit 1; }
  echo "[fix-perms]   .env -> group 999, mode 660 (owner preserved)"
fi

echo "[fix-perms] Done. The dashboard-api container can now write to:"
for d in "${DIRS[@]}"; do echo "  - $d/"; done
if [ -f "$ENV_FILE" ]; then echo "  - .env"; fi
echo "[fix-perms] If dashboard-api is already running, no restart is required."
