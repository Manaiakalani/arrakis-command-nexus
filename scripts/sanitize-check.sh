#!/usr/bin/env bash
# Reject commits that introduce secret material: private keys, provider tokens,
# JWTs, Discord webhook URLs, or deployment-specific identifiers such as your
# internal hostname, SSH user, or public IP.
#
# Usage:
#   bash scripts/sanitize-check.sh                # scan working tree
#   bash scripts/sanitize-check.sh --staged       # scan only staged changes
#   bash scripts/sanitize-check.sh --history      # scan ALL git history (slow)
#
# Wire into pre-commit:
#   ln -sf ../../scripts/sanitize-check.sh .git/hooks/pre-commit
#
# Deployment-specific patterns (your hostname, SSH user, public IP) belong in
# an untracked file, NOT here: this repository is public, so a pattern committed
# to catch your hostname would publish that hostname. Create
# `.sanitize-patterns.local` (gitignored, one extended-regex per line,
# `#` comments allowed):
#
#   spicebox
#   duneadmin
#   203\.0\.113\.42
#
set -euo pipefail

mode="${1:-tree}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_PATTERN_FILE="$REPO_ROOT/.sanitize-patterns.local"

# Unambiguous secret material. Kept deliberately narrow: this runs as a
# pre-commit hook, and a scanner that cries wolf is a scanner people disable.
patterns=(
  # Private keys of every flavour (SSH, RSA, EC, PGP)
  '-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----'
  'PuTTY-User-Key-File-[0-9]'
  # GitHub tokens: ghp_/gho_/ghu_/ghs_/ghr_ and fine-grained PATs
  'gh[pousr]_[A-Za-z0-9]{36}'
  'github_pat_[A-Za-z0-9_]{50,}'
  # Cloud + SaaS provider keys
  'AKIA[0-9A-Z]{16}'
  'ASIA[0-9A-Z]{16}'
  'AIza[0-9A-Za-z_-]{35}'
  'xox[abposr]-[0-9A-Za-z-]{10,}'
  'sk-[A-Za-z0-9]{32,}'
  'npm_[A-Za-z0-9]{36}'
  # JWT / HS256+RS256 token prefix
  'eyJhbGciOiJ'
  # Authorization headers carrying a real credential
  'Bearer [A-Za-z0-9._~+/-]{30,}'
  # Real Discord webhook URLs (the token segment is the secret)
  'discord(app)?\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]{20,}'
  # Battlegroup server unique name (identifies your world to Funcom FLS)
  'sh-[0-9a-f]{16}-[a-z]{6}'
  # postgres:// / amqp:// URLs carrying an inline password
  '(postgres|postgresql|amqps?)://[A-Za-z0-9._-]+:[^@/${:]{6,}@'
)

# Extra, deployment-specific patterns from the untracked local file.
if [[ -f "$LOCAL_PATTERN_FILE" ]]; then
  while IFS= read -r line; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -n "$line" ]] && patterns+=("$line")
  done <"$LOCAL_PATTERN_FILE"
fi

# Placeholders and documented examples are not leaks. Anchored on the value
# itself so it cannot mask a real secret elsewhere on the line.
ALLOW='change-me|changeme|CHANGEME|your-user|your-host|your-domain|YOUR_|<[A-Za-z_-]+>|xxxx|example\.com|placeholder|REDACTED|EXAMPLE'

# Paths that legitimately contain pattern-like text: the scanners themselves
# (they embed the patterns) and the lockfile (integrity hashes look like keys).
EXCLUDES=(
  ':!scripts/sanitize-check.sh'
  ':!scripts/security-audit.sh'
  ':!dashboard/frontend/package-lock.json'
)

filter_allowed() {
  grep -vE "$ALLOW" || true
}

scan() {
  local p hits=0 found
  for p in "${patterns[@]}"; do
    case "$mode" in
      --staged | staged)
        found="$({ git diff --cached -U0 -- "${EXCLUDES[@]}" || true; } | { grep -E -e "^\+.*$p" 2>/dev/null || true; } | filter_allowed)"
        if [[ -n "$found" ]]; then
          echo "SECRET: pattern '$p' detected in staged changes"
          printf '%s\n' "$found" | sed 's/^/    /'
          hits=$((hits + 1))
        fi
        ;;
      --history | history)
        found="$({ git log --all -p -S "$p" --pickaxe-regex -- "${EXCLUDES[@]}" 2>/dev/null || true; } | { grep -E -e "^\+.*$p" 2>/dev/null || true; } | filter_allowed)"
        if [[ -n "$found" ]]; then
          echo "SECRET: pattern '$p' present in git history (run git filter-repo to scrub, then rotate the credential)"
          printf '%s\n' "$found" | sed 's/^/    /' | head -5
          hits=$((hits + 1))
        fi
        ;;
      *)
        found="$({ git grep -nE -e "$p" -- "${EXCLUDES[@]}" 2>/dev/null || true; } | filter_allowed)"
        if [[ -n "$found" ]]; then
          echo "SECRET: pattern '$p' detected in tracked files"
          printf '%s\n' "$found" | sed 's/^/    /'
          hits=$((hits + 1))
        fi
        ;;
    esac
  done

  echo
  if ((hits == 0)); then
    if [[ -f "$LOCAL_PATTERN_FILE" ]]; then
      echo "  ALL CLEAN (including $(basename "$LOCAL_PATTERN_FILE"))"
    else
      echo '  ALL CLEAN'
      echo "  note: no .sanitize-patterns.local found -- deployment-specific values"
      echo "        (hostname, SSH user, public IP) are not being checked."
    fi
    exit 0
  fi
  echo "  $hits pattern(s) matched"
  exit 1
}

scan
