#!/usr/bin/env bash
set -euo pipefail

# Self-update script for the Dune Awakening Docker Server stack.
# Checks for repository updates and refreshes the management tooling.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
init_dune_env "$0"

VERSION_FILE="$PROJECT_ROOT/VERSION"

repo_url() {
  if [[ -n "${DUNE_REPO_URL:-}" ]]; then
    printf '%s\n' "$DUNE_REPO_URL"
  elif have_git_checkout; then
    git -C "$PROJECT_ROOT" remote get-url origin 2>/dev/null || true
  fi
}

current_version() {
  if [[ -f "$VERSION_FILE" ]]; then
    tr -d '[:space:]' < "$VERSION_FILE"
  else
    printf '0.0.0\n'
  fi
}

have_git_checkout() {
  have_command git && [[ -d "$PROJECT_ROOT/.git" ]]
}

remote_ref() {
  local ref=''

  ref="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  if [[ -n "$ref" ]]; then
    printf '%s\n' "$ref"
    return 0
  fi

  if git show-ref --verify --quiet refs/remotes/origin/main; then
    printf 'origin/main\n'
  elif git show-ref --verify --quiet refs/remotes/origin/master; then
    printf 'origin/master\n'
  else
    printf 'origin/%s\n' "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || printf 'main')"
  fi
}

check_update() {
  printf 'Current version: %s\n' "$(current_version)"
  printf 'Checking for updates...\n'

  if have_git_checkout; then
    cd "$PROJECT_ROOT"
    git fetch origin --quiet 2>/dev/null || {
      log_warn 'Could not fetch from remote.'
      return 1
    }

    local local_hash remote_hash target_ref
    local_hash="$(git rev-parse HEAD)"
    target_ref="$(remote_ref)"
    remote_hash="$(git rev-parse "$target_ref" 2>/dev/null || printf 'unknown')"

    if [[ "$remote_hash" == 'unknown' ]]; then
      log_warn "Could not resolve remote ref $target_ref."
      return 1
    fi

    if [[ "$local_hash" == "$remote_hash" ]]; then
      printf 'Already up to date.\n'
      return 0
    fi

    printf 'Update available!\n'
    printf '  Local:  %s\n' "${local_hash:0:8}"
    printf '  Remote: %s\n' "${remote_hash:0:8}"
    return 2
  fi

  printf 'Not a git repository. Manual update required.\n'
  local url
  url="$(repo_url)"
  if [[ -n "$url" ]]; then
    printf 'Download the latest release from: %s/releases\n' "$url"
  else
    printf 'Set DUNE_REPO_URL or reinstall from the original Git remote.\n'
  fi
  return 1
}

do_update() {
  if ! have_git_checkout; then
    local url
    url="$(repo_url)"
    if [[ -n "$url" ]]; then
      die "Not a git checkout. Download the latest release from: $url/releases"
    fi
    die 'Not a git checkout. Set DUNE_REPO_URL or reinstall from the original Git remote.'
  fi

  log_step 'Updating Dune Awakening Docker Server...'
  cd "$PROJECT_ROOT"

  if [[ -f "$PROJECT_ROOT/.env" ]]; then
    cp "$PROJECT_ROOT/.env" "$PROJECT_ROOT/.env.backup.$(date +%Y%m%d%H%M%S)"
    log_info 'Backed up .env.'
  fi

  local current_branch old_head stashed='false'
  current_branch="$(git rev-parse --abbrev-ref HEAD)"
  old_head="$(git rev-parse HEAD)"

  if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    git stash push --include-untracked --quiet --message 'dune-self-update' || true
    stashed='true'
  fi

  git pull origin "$current_branch" --quiet

  if [[ "$stashed" == 'true' ]]; then
    git stash pop --quiet 2>/dev/null || log_warn 'Could not automatically restore stashed local changes.'
  fi

  if ! git diff --quiet "$old_head" HEAD -- dashboard; then
    log_step 'Dashboard changes detected, rebuilding...'
    if have_command docker && docker compose version >/dev/null 2>&1; then
      docker compose build dashboard-api dashboard-frontend 2>/dev/null || log_warn 'Dashboard rebuild skipped.'
    else
      log_warn 'Docker compose is unavailable; skipping dashboard rebuild.'
    fi
  fi

  printf 'Update complete! Version: %s\n' "$(current_version)"
  printf "Run './dune restart' to apply changes.\n"
}

case "${1:-check}" in
  check)
    check_update
    ;;
  update)
    do_update
    ;;
  *)
    printf 'Usage: %s {check|update}\n' "$0"
    exit 1
    ;;
esac
