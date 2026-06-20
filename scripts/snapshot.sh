#!/usr/bin/env bash
# Capture a point-in-time capacity snapshot for the Dune stack.
# shellcheck shell=bash

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SNAPSHOT_DIR="$PROJECT_ROOT/snapshots"
JSON_MODE='false'

usage() {
  cat <<'EOF'
Usage: snapshot.sh [--json]

Options:
  --json    Emit structured JSON to stdout and skip writing a snapshot file
  -h, --help  Show this help message
EOF
}

while (($# > 0)); do
  case "$1" in
    --json)
      JSON_MODE='true'
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

have_command() {
  command -v "$1" >/dev/null 2>&1
}

capture() {
  local command_text="$1"
  local output
  output="$(eval "$command_text" 2>&1)"
  local status=$?
  if ((status != 0)); then
    if [[ -n "$output" ]]; then
      printf '%s\n[exit %s]' "$output" "$status"
    else
      printf 'unavailable - command failed with exit %s' "$status"
    fi
    return 0
  fi
  if [[ -n "$output" ]]; then
    printf '%s' "$output"
  else
    printf 'no output'
  fi
}

capture_if_available() {
  local required_command="$1"
  local command_text="$2"
  if have_command "$required_command"; then
    capture "$command_text"
  else
    printf 'unavailable - %s not found' "$required_command"
  fi
}

json_string() {
  local value
  value="$(cat)"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\t'/\\t}"
  printf '"%s"\n' "$value"
}

json_field() {
  local indent="$1"
  local key="$2"
  local value="$3"
  local suffix="${4-,}"
  printf '%*s"%s": %s%s\n' "$indent" '' "$key" "$(printf '%s' "$value" | json_string)" "$suffix"
}

count_containers() {
  if ! have_command docker; then
    printf 'unavailable'
    return 0
  fi
  docker ps --format '{{.Names}}' 2>/dev/null | sed '/^[[:space:]]*$/d' | wc -l | tr -d '[:space:]'
}

game_container_count() {
  if ! have_command docker; then
    printf 'unavailable'
    return 0
  fi
  docker ps --format '{{.Names}}' 2>/dev/null | grep -Ei '(survival|overmap|deepdesert|director)' | wc -l | tr -d '[:space:]'
}

online_player_count() {
  local container
  if ! have_command docker; then
    printf 'unavailable - docker not found'
    return 0
  fi
  container="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -Ei 'postgres' | head -1 || true)"
  if [[ -z "$container" ]]; then
    printf 'unavailable - postgres container not running'
    return 0
  fi
  local result
  result="$(docker exec "$container" psql -U dune -d dune_sb_1_4_0_0 -Atc "SELECT count(*) FILTER (WHERE online_status = 'Online') FROM dune.encrypted_player_state;" 2>&1)"
  local status=$?
  if ((status != 0)); then
    printf 'unavailable - %s' "$result"
  elif [[ -n "$result" ]]; then
    printf '%s' "$result"
  else
    printf 'unavailable - no result'
  fi
}

docker_ps_with_restart_counts() {
  if ! have_command docker; then
    printf 'unavailable - docker not found'
    return 0
  fi
  local rows
  rows="$(docker ps --format '{{.Names}}	{{.Image}}	{{.Status}}' 2>&1)"
  local status=$?
  if ((status != 0)); then
    printf '%s\n[exit %s]' "$rows" "$status"
    return 0
  fi
  if [[ -z "$rows" ]]; then
    printf 'no running containers'
    return 0
  fi
  printf 'NAME\tIMAGE\tSTATUS\tRESTART_COUNT\n'
  while IFS=$'\t' read -r name image container_status; do
    [[ -n "$name" ]] || continue
    local restart_count
    restart_count="$(docker inspect -f '{{.RestartCount}}' "$name" 2>/dev/null || printf '?')"
    printf '%s\t%s\t%s\t%s\n' "$name" "$image" "$container_status" "$restart_count"
  done <<< "$rows"
}

write_section() {
  local file_path="$1"
  local title="$2"
  local body="$3"
  {
    printf '\n## %s\n\n' "$title"
    printf '%s\n' "$body"
  } >> "$file_path"
}

TIMESTAMP_FILE="$(date -u '+%Y%m%dT%H%M%SZ')"
TIMESTAMP_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
HOSTNAME_TEXT="$(capture_if_available hostname hostname)"
UPTIME_TEXT="$(capture_if_available uptime uptime)"
MEMORY_TEXT="$(capture_if_available free 'free -h')"
SWAPON_TEXT="$(capture_if_available swapon 'swapon --show')"
CPU_TEXT="$(capture_if_available lscpu 'lscpu | head -20')"
TOP_CPU_TEXT="$(capture_if_available top 'top -bn1 -o %CPU | head -20')"
DISK_TEXT="$(capture_if_available df 'df -h')"
INODE_TEXT="$(capture_if_available df 'df -i')"
DOCKER_PS_TEXT="$(docker_ps_with_restart_counts)"
DOCKER_STATS_TEXT="$(capture_if_available docker "docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.PIDs}}'")"
GIT_LOG_TEXT="$(capture_if_available git "git -C '$PROJECT_ROOT' log --oneline -5")"
GIT_STATUS_TEXT="$(capture_if_available git "git -C '$PROJECT_ROOT' status --short")"
CONTAINER_COUNT="$(count_containers)"
GAME_CONTAINER_COUNT="$(game_container_count)"
ONLINE_PLAYERS="$(online_player_count)"
GAME_CAPACITY_TEXT="$(printf 'game_containers=%s\nonline_players=%s' "$GAME_CONTAINER_COUNT" "$ONLINE_PLAYERS")"

if [[ "$JSON_MODE" == 'true' ]]; then
  printf '{\n'
  json_field 2 timestamp_utc "$TIMESTAMP_ISO"
  json_field 2 hostname "$HOSTNAME_TEXT"
  json_field 2 uptime "$UPTIME_TEXT"
  printf '  "memory": {\n'
  json_field 4 free_h "$MEMORY_TEXT"
  json_field 4 swapon_show "$SWAPON_TEXT" ''
  printf '  },\n'
  printf '  "cpu": {\n'
  json_field 4 lscpu_head_20 "$CPU_TEXT"
  json_field 4 top_cpu_head_20 "$TOP_CPU_TEXT" ''
  printf '  },\n'
  printf '  "disk": {\n'
  json_field 4 filesystem_usage "$DISK_TEXT"
  json_field 4 inode_usage "$INODE_TEXT" ''
  printf '  },\n'
  printf '  "docker": {\n'
  json_field 4 container_count "$CONTAINER_COUNT"
  json_field 4 game_container_count "$GAME_CONTAINER_COUNT"
  json_field 4 ps_with_restart_counts "$DOCKER_PS_TEXT"
  json_field 4 stats_no_stream "$DOCKER_STATS_TEXT" ''
  printf '  },\n'
  printf '  "git": {\n'
  json_field 4 log_oneline_5 "$GIT_LOG_TEXT"
  json_field 4 status_short "$GIT_STATUS_TEXT" ''
  printf '  },\n'
  json_field 2 online_players "$ONLINE_PLAYERS" ''
  printf '}\n'
  exit 0
fi

mkdir -p "$SNAPSHOT_DIR"
SNAPSHOT_FILE="$SNAPSHOT_DIR/snapshot-$TIMESTAMP_FILE.txt"

{
  printf 'Dune capacity snapshot\n'
  printf 'Timestamp UTC: %s\n' "$TIMESTAMP_ISO"
  printf 'Hostname: %s\n' "$HOSTNAME_TEXT"
  printf 'Uptime: %s\n' "$UPTIME_TEXT"
} > "$SNAPSHOT_FILE"

write_section "$SNAPSHOT_FILE" 'Memory - free -h' "$MEMORY_TEXT"
write_section "$SNAPSHOT_FILE" 'Swap - swapon --show' "$SWAPON_TEXT"
write_section "$SNAPSHOT_FILE" 'CPU - lscpu head -20' "$CPU_TEXT"
write_section "$SNAPSHOT_FILE" 'Top CPU consumers - top -bn1 -o %CPU head -20' "$TOP_CPU_TEXT"
write_section "$SNAPSHOT_FILE" 'Filesystem usage - df -h' "$DISK_TEXT"
write_section "$SNAPSHOT_FILE" 'Inode usage - df -i' "$INODE_TEXT"
write_section "$SNAPSHOT_FILE" 'Docker containers - docker ps with restart counts' "$DOCKER_PS_TEXT"
write_section "$SNAPSHOT_FILE" 'Docker stats - docker stats --no-stream' "$DOCKER_STATS_TEXT"
write_section "$SNAPSHOT_FILE" 'Git deploy state - log --oneline -5' "$GIT_LOG_TEXT"
write_section "$SNAPSHOT_FILE" 'Git deploy state - status --short' "$GIT_STATUS_TEXT"
write_section "$SNAPSHOT_FILE" 'Game capacity' "$GAME_CAPACITY_TEXT"

printf 'Snapshot written to %s - host=%s containers=%s game_containers=%s online_players=%s\n' "$SNAPSHOT_FILE" "$HOSTNAME_TEXT" "$CONTAINER_COUNT" "$GAME_CONTAINER_COUNT" "$ONLINE_PLAYERS"
