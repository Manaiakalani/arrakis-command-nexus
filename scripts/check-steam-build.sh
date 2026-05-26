#!/usr/bin/env bash
# Check Steam for the latest build ID of an app
# Usage: ./check-steam-build.sh <APP_ID>

set -euo pipefail

APP_ID="${1:-}"

if [[ -z "$APP_ID" ]]; then
  echo "ERROR: APP_ID required" >&2
  exit 1
fi

# Check if steamcmd is available
if ! command -v steamcmd &>/dev/null; then
  echo "ERROR: steamcmd not found" >&2
  exit 1
fi

# Query Steam for app info and extract build ID
steamcmd +login anonymous +app_info_print "$APP_ID" +quit 2>/dev/null | \
  grep -A 5 '"public"' | \
  grep -oP '"buildid"\s+"\K\d+' | \
  head -1 || echo "ERROR: Could not parse build ID" >&2
