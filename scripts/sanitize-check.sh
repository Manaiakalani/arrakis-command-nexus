#!/usr/bin/env bash
# Reject commits that introduce internal hostnames, IPs, JWT/HS256 tokens,
# Discord webhook URLs, or RMQ secrets in tracked files.
#
# Usage:
#   bash scripts/sanitize-check.sh                # scan working tree
#   bash scripts/sanitize-check.sh --staged       # scan only staged changes
#   bash scripts/sanitize-check.sh --history      # scan ALL git history (slow)
#
# Wire into pre-commit:
#   ln -sf ../../scripts/sanitize-check.sh .git/hooks/pre-commit

set -euo pipefail

mode="${1:-tree}"

# Pattern allowlist intentionally avoids false-positives like "Manaiakalani"
# (the public GitHub username) and EXTERNAL_ADDRESS=auto (the placeholder).
patterns=(
  # Internal hostname/SSH user pairs
  'dunebrah@daspicebox'
  '@daspicebox\b'
  '\bdaspicebox\b'
  '\bdunebrah\b'
  # IPv4 of the production host (anchored to avoid false positives with other IPs)
  '15\.218\.126\.246'
  # Battlegroup ID (Funcom-issued, MUST stay private)
  'sh-35e6117067fc3ff3-vfnykq'
  # JWT-prefix wildcard for any token that begins HS256
  'eyJhbGciOiJIUzI1NiIs'
  # Discord webhook real URLs (placeholder uses an ellipsis character)
  'discord\.com/api/webhooks/[0-9]+/[A-Za-z0-9_\-]{20,}'
  # RMQ secret prefix from past incidents
  'NEoS05J-Cp9LjVy'
)

scan() {
  local p hits=0
  for p in "${patterns[@]}"; do
    case "$mode" in
      --staged|staged)
        if git diff --cached -U0 -- ':!scripts/sanitize-check.sh' | grep -E "^\+.*$p" >/dev/null 2>&1; then
          echo "SECRET: pattern '$p' detected in staged changes"
          git diff --cached --name-only -G "$p" -- ':!scripts/sanitize-check.sh' | sed 's/^/    /'
          hits=$((hits+1))
        fi
        ;;
      --history|history)
        # Ignore the scanner itself (it intentionally contains the patterns).
        if git log --all -p -S "$p" -- ':!scripts/sanitize-check.sh' 2>/dev/null | grep -qE "$p"; then
          echo "SECRET: pattern '$p' present in git history (run filter-repo to scrub)"
          hits=$((hits+1))
        fi
        ;;
      *)
        # Ignore the scanner itself (it contains the patterns intentionally).
        if git grep -nE "$p" -- ':!scripts/sanitize-check.sh' 2>/dev/null; then
          hits=$((hits+1))
        fi
        ;;
    esac
  done
  echo
  if [ "$hits" -eq 0 ]; then
    echo "  ALL CLEAN"
    exit 0
  else
    echo "  $hits pattern(s) matched"
    exit 1
  fi
}

scan
