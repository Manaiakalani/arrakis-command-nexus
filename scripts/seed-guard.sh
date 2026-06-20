#!/bin/sh
# seed-guard.sh -- continuously pin the world reset seed so player bases are
# never hidden by an "A storm has reset the map" seed mismatch.
#
# This is defense-in-depth alongside the pre-game enforcement in
# survival-pre-start.sh. The game server rewrites world_partition_reset_seed
# (and the map/farm seed tables) back to its default during startup and runtime;
# if a boot reads the wrong seed it hides every building created under a
# different seed. The pre-start script forces the correct seed before the game
# starts, and this guardian keeps it pinned continuously so the value is already
# correct at ANY moment a boot might read it -- regardless of timing or which
# service triggers the restart.
#
# Safe no-op when WORLD_RESET_SEED is unset (idles without touching the DB).
set -u

DB_NAME="${POSTGRES_DB_NAME:-dune_sb_1_4_0_0}"
RESET_SEED="${WORLD_RESET_SEED:-}"
INTERVAL="${SEED_GUARD_INTERVAL:-300}"
PGHOST="${POSTGRES_HOST:-postgres}"
export PGPASSWORD="${POSTGRES_DUNE_PASSWORD:-}"

if [ -z "$RESET_SEED" ]; then
  echo "[seed-guard] WORLD_RESET_SEED is not set; seed protection disabled. Idling."
  while true; do sleep 3600; done
fi

# Only integers are valid seeds; refuse anything else to avoid SQL injection.
case "$RESET_SEED" in
  ''|*[!0-9]*)
    echo "[seed-guard] ERROR: WORLD_RESET_SEED='$RESET_SEED' is not a non-negative integer. Idling."
    while true; do sleep 3600; done
    ;;
esac

echo "[seed-guard] Pinning world reset seed=$RESET_SEED every ${INTERVAL}s (db=$DB_NAME host=$PGHOST)"

while true; do
  CHANGED=$(psql -h "$PGHOST" -p 5432 -U dune -d "$DB_NAME" -v ON_ERROR_STOP=0 -t -A 2>/dev/null <<SQL
WITH p AS (UPDATE dune.world_partition_reset_seed SET world_reset_seed=$RESET_SEED WHERE world_reset_seed<>$RESET_SEED RETURNING 1),
     m AS (UPDATE dune.world_map_reset_seed       SET world_reset_seed=$RESET_SEED WHERE world_reset_seed<>$RESET_SEED RETURNING 1),
     f AS (UPDATE dune.world_farm_reset_seed      SET world_reset_seed=$RESET_SEED WHERE world_reset_seed<>$RESET_SEED RETURNING 1)
SELECT (SELECT count(*) FROM p)+(SELECT count(*) FROM m)+(SELECT count(*) FROM f);
SQL
)
  if [ -n "$CHANGED" ] && [ "$CHANGED" != "0" ]; then
    echo "[seed-guard] $(date -u +%Y-%m-%dT%H:%M:%SZ) corrected seed drift on ${CHANGED} row(s) -> ${RESET_SEED}"
  fi
  sleep "$INTERVAL"
done
