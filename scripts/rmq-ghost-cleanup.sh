#!/bin/bash
# rmq-ghost-cleanup.sh - Close duplicate / ghost player RMQ connections
#
# Symptom: Player gets "Error: P83" when joining or travelling between maps,
# and game-rmq logs show:
#   precondition_failed: queue '<HEXID>_queue' in vhost '/' in use
#
# Root cause: A previous login from the same player did not cleanly close
# its AMQP connection. The stale connection still holds a consumer on the
# player's chat queue, so the game server's queue.delete (which precedes
# queue.declare for the new session) fails. The client sees P83.
#
# Fix (two passes):
#   1. Enumerate player connections (16-char hex Steam IDs) and close any user
#      with more than one running connection (keeps the newest; the older is
#      the ghost). The live client reconnects within ~1s.
#   2. Reap orphaned <HEXID>_queue queues that have 0 consumers AND whose owner
#      has no running player connection (fully offline). These linger after a
#      connection drops, keep accumulating presence/chat messages, and can trip
#      the RMQ memory watermark (a broker-wide P83 cause). The game re-declares
#      the queue on the player's next login, so deleting an unused one is safe.
#
# Usage:
#   ./scripts/rmq-ghost-cleanup.sh             # dry-run, list candidates only
#   ./scripts/rmq-ghost-cleanup.sh --apply     # close ghost dupes + reap orphans
#   ./scripts/rmq-ghost-cleanup.sh --apply --user 35E6117067FC3FF3   # one user
#
set -euo pipefail

APPLY=0
TARGET_USER=""
CONTAINER="${DUNE_GAME_RMQ_CONTAINER:-dune-awakening-game-rmq-1}"

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --user) TARGET_USER="$2"; shift 2 ;;
    --container) CONTAINER="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,26p' "$0"
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "ERROR: container '$CONTAINER' is not running" >&2
  exit 1
fi

MIN_AGE_SECONDS="${GHOST_MIN_AGE_SECONDS:-60}"
NOW_MS=$(($(date +%s) * 1000))

# Collect (pid, user, connected_at_ms) for running connections of 16-hex Steam ID
# users. For each user with > 1 running connection, keep the newest and emit the
# older PIDs (only those older than MIN_AGE_SECONDS) as cleanup candidates.
mapfile -t GHOST_LINES < <(
  docker exec "$CONTAINER" rabbitmqctl --quiet list_connections pid user state connected_at 2>/dev/null \
    | awk -v now="$NOW_MS" -v min_age_ms="$((MIN_AGE_SECONDS * 1000))" '
        NR>1 && $2 ~ /^[0-9A-Fa-f]{16}$/ && $3 == "running" {
          pid[$2,++c[$2]] = $1
          ts[$2,c[$2]]   = $4
        }
        END {
          for (u in c) {
            if (c[u] < 2) continue
            # find max ts (newest)
            max_idx = 1; max_ts = ts[u,1]
            for (i = 2; i <= c[u]; i++) if (ts[u,i] > max_ts) { max_ts = ts[u,i]; max_idx = i }
            for (i = 1; i <= c[u]; i++) {
              if (i == max_idx) continue
              age_ms = now - ts[u,i]
              if (age_ms < min_age_ms) continue
              printf "%s\t%s\t%d\n", u, pid[u,i], age_ms/1000
            }
          }
        }'
)

if [ -n "$TARGET_USER" ]; then
  # Re-filter to just this user
  FILTERED=()
  for line in "${GHOST_LINES[@]}"; do
    if [[ "$line" == "${TARGET_USER}"* ]]; then FILTERED+=("$line"); fi
  done
  GHOST_LINES=("${FILTERED[@]}")
fi

# ---------------------------------------------------------------------------
# Pass 1 report: stale duplicate player connections (the classic P83 ghost)
# ---------------------------------------------------------------------------
if [ ${#GHOST_LINES[@]} -eq 0 ]; then
  echo "[rmq-ghost-cleanup] No stale duplicate connections found (min age ${MIN_AGE_SECONDS}s)."
else
  echo "[rmq-ghost-cleanup] Stale duplicate connection candidates (newer connection kept; older listed):"
  for line in "${GHOST_LINES[@]}"; do
    IFS=$'\t' read -r u pid age <<<"$line"
    echo "  - user=$u  pid=$pid  age=${age}s"
  done
fi

# ---------------------------------------------------------------------------
# Pass 2: orphaned player queues (0 consumers, owner fully offline)
#
# After a player's connection drops, their <HEXID>_queue can linger with no
# consumer. Presence/chat producers keep publishing to it, so it grows and can
# eventually trip the RMQ memory watermark -> publishers block -> broker-wide
# P83. Pass 1 cannot clear it (there is no duplicate connection to close). Reap
# it only when the owner has NO player connection at all (ANY connection state
# counts as online, so a blocked/flow-controlled live player is never mistaken
# for offline) and the queue has 0 consumers. Discovery FAILS CLOSED: if the
# broker cannot be queried we refuse to reap anything. --if-unused makes the
# broker re-check (no consumers) atomically at delete, and the game re-declares
# the queue on the next login, so deleting an unused offline queue is safe.
# ---------------------------------------------------------------------------
# Print the set of Steam IDs (16-hex) that currently have ANY player connection
# (space-bracketed, upper-cased). Returns non-zero if the broker cannot be
# queried, so callers can fail closed.
fetch_online_players() {
  local out u acc=" "
  out="$(docker exec "$CONTAINER" rabbitmqctl --quiet list_connections user)" || return 1
  while read -r u; do
    [ -n "$u" ] && acc="${acc}${u^^} "
  done < <(awk '$1 ~ /^[0-9A-Fa-f]{16}$/ {print $1}' <<<"$out")
  printf '%s' "$acc"
}

ORPHAN_QUEUES=()
ORPHAN_MSGS=()
if ! ONLINE_PLAYERS="$(fetch_online_players)"; then
  echo "[rmq-ghost-cleanup] ERROR: cannot list RabbitMQ connections; refusing to reap any queue." >&2
elif ! QUEUE_OUT="$(docker exec "$CONTAINER" rabbitmqctl --quiet list_queues name consumers messages)"; then
  echo "[rmq-ghost-cleanup] ERROR: cannot list RabbitMQ queues; refusing to reap any queue." >&2
else
  while read -r qname qmsgs; do
    [ -z "$qname" ] && continue
    hex="${qname%_queue}"
    # Skip if the owner has any live connection (could be mid-travel/login).
    case "$ONLINE_PLAYERS" in *" ${hex^^} "*) continue ;; esac
    if [ -n "$TARGET_USER" ] && [ "${hex^^}" != "${TARGET_USER^^}" ]; then continue; fi
    ORPHAN_QUEUES+=("$qname")
    ORPHAN_MSGS+=("$qmsgs")
  done < <(awk '$1 ~ /^[0-9A-Fa-f]{16}_queue$/ && $2 == 0 {print $1, $3}' <<<"$QUEUE_OUT")
fi

if [ ${#ORPHAN_QUEUES[@]} -eq 0 ]; then
  echo "[rmq-ghost-cleanup] No orphaned offline-player queues found."
else
  echo "[rmq-ghost-cleanup] Orphaned offline-player queue candidates (0 consumers, owner offline):"
  for i in "${!ORPHAN_QUEUES[@]}"; do
    echo "  - queue=${ORPHAN_QUEUES[$i]}  messages=${ORPHAN_MSGS[$i]}  (discarded on reap; game re-declares on next login)"
  done
fi

# ---------------------------------------------------------------------------
# Apply / dry-run decision (covers both passes)
# ---------------------------------------------------------------------------
if [ ${#GHOST_LINES[@]} -eq 0 ] && [ ${#ORPHAN_QUEUES[@]} -eq 0 ]; then
  echo "[rmq-ghost-cleanup] Nothing to do."
  exit 0
fi

if [ "$APPLY" -ne 1 ]; then
  echo ""
  echo "Dry-run only. Re-run with --apply to close stale duplicates and reap orphaned queues."
  exit 0
fi

REASON="ghost-cleanup-$(date -u +%Y%m%dT%H%M%SZ)"
for line in "${GHOST_LINES[@]}"; do
  IFS=$'\t' read -r u pid age <<<"$line"
  echo "[rmq-ghost-cleanup] Closing pid=$pid (user=$u age=${age}s reason=$REASON)"
  docker exec "$CONTAINER" rabbitmqctl --quiet close_connection "$pid" "$REASON" || true
done

# Re-sample connections immediately before deleting and fail closed: a player
# who reconnected since the initial scan (or a transient broker error) spares
# their queue. --if-unused is the final atomic guard on the consumer count.
if [ ${#ORPHAN_QUEUES[@]} -gt 0 ]; then
  if ! ONLINE_NOW="$(fetch_online_players)"; then
    echo "[rmq-ghost-cleanup] ERROR: cannot re-list connections; skipping queue reaping." >&2
  else
    for q in "${ORPHAN_QUEUES[@]}"; do
      hex="${q%_queue}"
      case "$ONLINE_NOW" in
        *" ${hex^^} "*)
          echo "[rmq-ghost-cleanup] Skipping queue=$q: owner reconnected since scan."
          continue ;;
      esac
      echo "[rmq-ghost-cleanup] Deleting orphaned queue=$q (only if still unused)"
      docker exec "$CONTAINER" rabbitmqctl delete_queue --vhost / "$q" --if-unused || true
    done
  fi
fi

echo "[rmq-ghost-cleanup] Done."
