#!/usr/bin/env bash
# Detect and (optionally) repair duplicate (inventory_id, position_index)
# rows in dune.items. The game engine renders one row per slot, so duplicates
# silently lose visibility for one of them. Postgres has no UNIQUE constraint
# on (inventory_id, position_index) because the running game writes its own
# inventory state and a hard constraint would risk crashing the server, so
# this script provides offline repair instead.
#
# Usage:
#   bash scripts/inventory-conflicts.sh                  # report only
#   bash scripts/inventory-conflicts.sh --repair         # move the most-recent
#                                                          duplicate to a free
#                                                          slot, or delete it
#                                                          if no slot is free.
#
# Wire into a cron / systemd timer for periodic checks. Safe to run while the
# game server is online: the moves go through dune.items directly and load
# on the player's next main-menu rejoin (same as grant-item).

set -euo pipefail

mode="${1:-report}"

: "${PG_CONTAINER:=dune-awakening-postgres-1}"
: "${PG_USER:=dune}"
: "${PG_DB:=dune_sb_1_4_0_0}"

psql() {
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" "$@"
}

echo "== Detecting (inventory_id, position_index) duplicates =="
conflicts="$(psql -tA -c "
  SELECT inventory_id, position_index, count(*) AS rows
  FROM dune.items
  GROUP BY inventory_id, position_index
  HAVING count(*) > 1
  ORDER BY inventory_id, position_index;
")"

if [ -z "$conflicts" ]; then
  echo "  (no conflicts)"
  exit 0
fi

echo "$conflicts" | while IFS='|' read -r inv pos n; do
  [ -n "$inv" ] || continue
  echo "  inventory $inv slot $pos: $n rows"
  psql -tA -c "
    SELECT id, template_id, stack_size, is_new
    FROM dune.items WHERE inventory_id=$inv AND position_index=$pos
    ORDER BY id;
  " | sed 's/^/      /'
done

if [ "$mode" != "--repair" ]; then
  echo
  echo "Run with --repair to relocate or delete the duplicates."
  exit 1
fi

echo
echo "== Repairing =="
echo "$conflicts" | while IFS='|' read -r inv pos n; do
  [ -n "$inv" ] || continue
  # Find max_item_count for this inventory (defaults to 35 for backpack-style).
  max_slots="$(psql -tA -c "SELECT COALESCE(max_item_count, 35) FROM dune.inventories WHERE id=$inv;")"
  # Find the highest item id at the conflicting slot - that is the "newest"
  # row, which we'll move (older rows are usually the player's real loot).
  newest_id="$(psql -tA -c "
    SELECT id FROM dune.items
    WHERE inventory_id=$inv AND position_index=$pos
    ORDER BY id DESC LIMIT 1;
  ")"
  # Find a free slot in [0, max_slots).
  free_slot="$(psql -tA -c "
    WITH used AS (
      SELECT DISTINCT position_index FROM dune.items
      WHERE inventory_id=$inv AND position_index < $max_slots
    )
    SELECT g FROM generate_series(0, $max_slots - 1) AS g
    WHERE g NOT IN (SELECT position_index FROM used)
    ORDER BY g LIMIT 1;
  ")"
  if [ -n "$free_slot" ]; then
    echo "  inventory $inv slot $pos: moving id=$newest_id to free slot $free_slot"
    psql -c "UPDATE dune.items SET position_index=$free_slot, is_new=true WHERE id=$newest_id;" >/dev/null
  else
    echo "  inventory $inv slot $pos: no free slot in [0,$max_slots), deleting id=$newest_id"
    psql -c "DELETE FROM dune.items WHERE id=$newest_id;" >/dev/null
  fi
done

echo
echo "== Verification =="
remaining="$(psql -tA -c "
  SELECT count(*) FROM (
    SELECT inventory_id, position_index FROM dune.items
    GROUP BY inventory_id, position_index HAVING count(*) > 1
  ) sub;
")"
echo "  $remaining remaining conflicts"
[ "$remaining" = "0" ] || exit 1
