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
# Output is in VDF (Valve Data Format), looking for: "buildid" "XXXXXXX"
TMPFILE=$(mktemp)
trap "rm -f $TMPFILE" EXIT

timeout 30 steamcmd +login anonymous +app_info_print "$APP_ID" +quit 2>/dev/null > "$TMPFILE" || {
  echo "ERROR: steamcmd query failed" >&2
  exit 1
}

# Look for buildid in the public branch section
# Pattern: "buildid"		"1234567"
BUILD_ID=$(grep -oP '"buildid"\s+"\K\d+' "$TMPFILE" | head -1)

if [[ -n "$BUILD_ID" ]]; then
  echo "$BUILD_ID"
else
  echo "ERROR: Could not parse build ID" >&2
  exit 1
fi
