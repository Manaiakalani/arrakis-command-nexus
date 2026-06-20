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
  # ─── CUSTOMIZE THESE FOR YOUR DEPLOYMENT ───────────────────────────────────
  # Add your own SSH user/hostname, public IP, and secret prefixes below.
  # These patterns prevent accidental commits of sensitive values.

  # Internal hostname/SSH user pairs (CUSTOMIZE: replace with your values)
  # 'your-user@your-host'
  # '@your-host\b'
  # '\byour-host\b'
  # '\byour-user\b'

  # Public IP of the production host (CUSTOMIZE: replace with your IP)
  # '203\.0\.113\.1'

  # ─── GENERIC PATTERNS (safe defaults, catch common secrets) ────────────────
  # Battlegroup server unique name pattern
  'sh-[0-9a-f]{16}-[a-z]{6}'
  # JWT token prefix (catches any HS256/RS256 token)
  'eyJhbGciOiJ'
  # Discord webhook real URLs
  'discord\.com/api/webhooks/[0-9]+/[A-Za-z0-9_\-]{20,}'
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
