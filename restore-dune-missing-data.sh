#!/usr/bin/env bash
set -euo pipefail

CONTAINER=dune-awakening-postgres-1
LIVE_DB=dune_sb_1_4_0_0
BACKUP_DB=dune_restore_probe
PGUSER=dune
PGHOST=localhost
PGPASSWORD='REDACTED_DB_PASSWORD'
BACKUP_FILE=/home/REDACTED_USER/dune-server-docker/backups/dune-db-pre-reset.dump
BACKUP_FILE_IN_CONTAINER=/tmp/dune-db-pre-reset.dump

# Make sure the backup is available inside the Postgres container.
docker cp "$BACKUP_FILE" "$CONTAINER:$BACKUP_FILE_IN_CONTAINER" >/dev/null 2>&1 || true

# Create a scratch DB with the backup restored for comparison and lookup.
docker exec -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" psql -U "$PGUSER" -h "$PGHOST" -d postgres -v ON_ERROR_STOP=1 <<SQL >/dev/null 2>&1
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '$BACKUP_DB' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "$BACKUP_DB";
CREATE DATABASE "$BACKUP_DB";
SQL
docker exec -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" pg_restore -v --clean --if-exists --no-owner --no-privileges -d "$BACKUP_DB" -U "$PGUSER" -h "$PGHOST" "$BACKUP_FILE_IN_CONTAINER" >/tmp/pg_restore_probe.log 2>&1 || true

echo '== All tables from backup TOC ==' 
docker exec "$CONTAINER" pg_restore -l "$BACKUP_FILE_IN_CONTAINER" | grep -E ' TABLE ' | sed -E 's/.* TABLE [^ ]+ ([^ ]+).*/\1/' | sort -u

echo

echo '== Tables empty in live DB but populated in backup ==' 
while read -r tbl; do
  [ -n "$tbl" ] || continue
  live_exists=$(docker exec -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" psql -U "$PGUSER" -h "$PGHOST" -d "$LIVE_DB" -Atqc "SELECT to_regclass('dune.${tbl}') IS NOT NULL" 2>/dev/null | tr -d '[:space:]' || true)
  if [ "$live_exists" = 't' ]; then
    live_count=$(docker exec -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" psql -U "$PGUSER" -h "$PGHOST" -d "$LIVE_DB" -Atqc "SELECT COALESCE((SELECT count(*) FROM dune.${tbl}), 0)" 2>/dev/null | tr -d '[:space:]' || true)
  else
    live_count=0
  fi
  backup_count=$(docker exec -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" psql -U "$PGUSER" -h "$PGHOST" -d "$BACKUP_DB" -Atqc "SELECT COALESCE((SELECT count(*) FROM dune.${tbl}), 0)" 2>/dev/null | tr -d '[:space:]' || true)
  if [ "$live_count" = '0' ] && [ "$backup_count" != '0' ]; then
    echo "$tbl|$live_count|$backup_count"
  fi
done < <(docker exec "$CONTAINER" pg_restore -l "$BACKUP_FILE_IN_CONTAINER" | grep -E ' TABLE ' | sed -E 's/.* TABLE [^ ]+ ([^ ]+).*/\1/' | sort -u)

echo

echo '== Restoring missing rows ==' 

restore_table() {
  local name="$1"
  shift
  echo "Restoring $name"
  "$@"
}

restore_map_areas() {
  echo 'Restoring map_areas'
  docker exec "$CONTAINER" sh -c "rm -f /tmp/restore_map_areas.csv && PGPASSWORD='$PGPASSWORD' psql -U '$PGUSER' -h '$PGHOST' -d '$BACKUP_DB' -v ON_ERROR_STOP=1 -c \"COPY (SELECT account_id, area_id, time_discovered, time_first_entered, survey_point_marker_id, map_name, items_surveyed_target, items_surveyed_progress FROM dune.map_areas) TO STDOUT WITH CSV\" > /tmp/restore_map_areas.csv"
  docker exec -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" psql -U "$PGUSER" -h "$PGHOST" -d "$LIVE_DB" -v ON_ERROR_STOP=1 -c "
    SET session_replication_role = replica;
    CREATE TEMP TABLE stage_map_areas (account_id bigint, area_id smallint, time_discovered timestamptz, time_first_entered timestamptz, survey_point_marker_id bigint, map_name text, items_surveyed_target jsonb, items_surveyed_progress jsonb) ON COMMIT DROP;
    \copy stage_map_areas(account_id, area_id, time_discovered, time_first_entered, survey_point_marker_id, map_name, items_surveyed_target, items_surveyed_progress) FROM '/tmp/restore_map_areas.csv' WITH CSV;
    INSERT INTO dune.map_areas (character_id, area_id, time_discovered, time_first_entered, survey_point_marker_id, map_name, items_surveyed_target, items_surveyed_progress)
    SELECT eps.id, s.area_id, s.time_discovered, s.time_first_entered, s.survey_point_marker_id, s.map_name, s.items_surveyed_target, s.items_surveyed_progress
    FROM stage_map_areas s
    JOIN dune.encrypted_player_state eps ON eps.account_id = s.account_id
    WHERE NOT EXISTS (
      SELECT 1 FROM dune.map_areas l
      WHERE l.character_id = eps.id AND l.area_id = s.area_id AND l.map_name = s.map_name
    );
    DROP TABLE stage_map_areas;
    SET session_replication_role = DEFAULT;
  " >/dev/null
}

restore_player_respawn_locations() {
  echo 'Restoring player_respawn_locations'
  docker exec "$CONTAINER" sh -c "rm -f /tmp/restore_player_respawn_locations.csv && PGPASSWORD='$PGPASSWORD' psql -U '$PGUSER' -h '$PGHOST' -d '$BACKUP_DB' -v ON_ERROR_STOP=1 -c \"COPY (SELECT id, \"group\", locator_transform, locator_actor_id, locator_name, map, dimension, last_used_timestamp, locator_name_index, account_id FROM dune.player_respawn_locations) TO STDOUT WITH CSV\" > /tmp/restore_player_respawn_locations.csv"
  docker exec -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" psql -U "$PGUSER" -h "$PGHOST" -d "$LIVE_DB" -v ON_ERROR_STOP=1 -c "
    SET session_replication_role = replica;
    CREATE TEMP TABLE stage_player_respawn_locations (id uuid, \"group\" text, locator_transform transform, locator_actor_id bigint, locator_name text, map text, dimension integer, last_used_timestamp bigint, locator_name_index integer, account_id bigint) ON COMMIT DROP;
    \copy stage_player_respawn_locations(id, \"group\", locator_transform, locator_actor_id, locator_name, map, dimension, last_used_timestamp, locator_name_index, account_id) FROM '/tmp/restore_player_respawn_locations.csv' WITH CSV;
    INSERT INTO dune.player_respawn_locations (id, \"group\", locator_transform, locator_actor_id, locator_name, map, dimension, last_used_timestamp, locator_name_index, character_id)
    SELECT s.id, s.\"group\", s.locator_transform, s.locator_actor_id, s.locator_name, s.map, s.dimension, s.last_used_timestamp, s.locator_name_index, eps.id
    FROM stage_player_respawn_locations s
    JOIN dune.encrypted_player_state eps ON eps.account_id = s.account_id
    WHERE NOT EXISTS (
      SELECT 1 FROM dune.player_respawn_locations l
      WHERE l.id = s.id
    );
    DROP TABLE stage_player_respawn_locations;
    SET session_replication_role = DEFAULT;
  " >/dev/null
}

restore_player_tags() {
  echo 'Restoring player_tags'
  docker exec "$CONTAINER" sh -c "rm -f /tmp/restore_player_tags.csv && PGPASSWORD='$PGPASSWORD' psql -U '$PGUSER' -h '$PGHOST' -d '$BACKUP_DB' -v ON_ERROR_STOP=1 -c \"COPY (SELECT tag, account_id FROM dune.player_tags) TO STDOUT WITH CSV\" > /tmp/restore_player_tags.csv"
  docker exec -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" psql -U "$PGUSER" -h "$PGHOST" -d "$LIVE_DB" -v ON_ERROR_STOP=1 -c "
    SET session_replication_role = replica;
    CREATE TEMP TABLE stage_player_tags (tag text, account_id bigint) ON COMMIT DROP;
    \copy stage_player_tags(tag, account_id) FROM '/tmp/restore_player_tags.csv' WITH CSV;
    INSERT INTO dune.player_tags (tag, character_id)
    SELECT s.tag, eps.id
    FROM stage_player_tags s
    JOIN dune.encrypted_player_state eps ON eps.account_id = s.account_id
    WHERE NOT EXISTS (
      SELECT 1 FROM dune.player_tags l
      WHERE l.character_id = eps.id AND l.tag = s.tag
    );
    DROP TABLE stage_player_tags;
    SET session_replication_role = DEFAULT;
  " >/dev/null
}

restore_recovered_vehicles() {
  echo 'Restoring recovered_vehicles'
  docker exec "$CONTAINER" sh -c "rm -f /tmp/restore_recovered_vehicles.csv && PGPASSWORD='$PGPASSWORD' psql -U '$PGUSER' -h '$PGHOST' -d '$BACKUP_DB' -v ON_ERROR_STOP=1 -c \"COPY (SELECT vehicle_id, time_stored, chassis_durability, vehicle_name, customization_id, reason, account_id FROM dune.recovered_vehicles) TO STDOUT WITH CSV\" > /tmp/restore_recovered_vehicles.csv"
  docker exec -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" psql -U "$PGUSER" -h "$PGHOST" -d "$LIVE_DB" -v ON_ERROR_STOP=1 -c "
    SET session_replication_role = replica;
    CREATE TEMP TABLE stage_recovered_vehicles (vehicle_id bigint, time_stored timestamptz, chassis_durability real, vehicle_name text, customization_id text, reason recoveredvehiclereason, account_id bigint) ON COMMIT DROP;
    \copy stage_recovered_vehicles(vehicle_id, time_stored, chassis_durability, vehicle_name, customization_id, reason, account_id) FROM '/tmp/restore_recovered_vehicles.csv' WITH CSV;
    INSERT INTO dune.recovered_vehicles (vehicle_id, time_stored, chassis_durability, vehicle_name, customization_id, reason, character_id)
    SELECT s.vehicle_id, s.time_stored, s.chassis_durability, s.vehicle_name, s.customization_id, s.reason, eps.id
    FROM stage_recovered_vehicles s
    JOIN dune.encrypted_player_state eps ON eps.account_id = s.account_id
    WHERE NOT EXISTS (
      SELECT 1 FROM dune.recovered_vehicles l
      WHERE l.vehicle_id = s.vehicle_id
    );
    DROP TABLE stage_recovered_vehicles;
    SET session_replication_role = DEFAULT;
  " >/dev/null
}

restore_player_access_codes() {
  echo 'Restoring player_access_codes'
  docker exec "$CONTAINER" sh -c "rm -f /tmp/restore_player_access_codes.csv && PGPASSWORD='$PGPASSWORD' psql -U '$PGUSER' -h '$PGHOST' -d '$BACKUP_DB' -v ON_ERROR_STOP=1 -c \"COPY (SELECT account_id, access_code, access_code_type, is_resettable FROM dune.player_access_codes) TO STDOUT WITH CSV\" > /tmp/restore_player_access_codes.csv"
  docker exec -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" psql -U "$PGUSER" -h "$PGHOST" -d "$LIVE_DB" -v ON_ERROR_STOP=1 -c "
    SET session_replication_role = replica;
    CREATE TEMP TABLE stage_player_access_codes (account_id bigint, access_code integer, access_code_type integer, is_resettable boolean) ON COMMIT DROP;
    \copy stage_player_access_codes(account_id, access_code, access_code_type, is_resettable) FROM '/tmp/restore_player_access_codes.csv' WITH CSV;
    INSERT INTO dune.player_access_codes (access_code, access_code_type, is_resettable, character_id)
    SELECT s.access_code, s.access_code_type, s.is_resettable, eps.id
    FROM stage_player_access_codes s
    JOIN dune.encrypted_player_state eps ON eps.account_id = s.account_id
    WHERE NOT EXISTS (
      SELECT 1 FROM dune.player_access_codes l
      WHERE l.character_id = eps.id AND l.access_code = s.access_code AND l.access_code_type = s.access_code_type
    );
    DROP TABLE stage_player_access_codes;
    SET session_replication_role = DEFAULT;
  " >/dev/null
}

restore_buildings() {
  echo 'Restoring buildings'
  docker exec "$CONTAINER" sh -c "rm -f /tmp/restore_buildings.csv && PGPASSWORD='$PGPASSWORD' psql -U '$PGUSER' -h '$PGHOST' -d '$BACKUP_DB' -v ON_ERROR_STOP=1 -c \"COPY (SELECT id, owner_id FROM dune.buildings) TO STDOUT WITH CSV\" > /tmp/restore_buildings.csv"
  docker exec -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" psql -U "$PGUSER" -h "$PGHOST" -d "$LIVE_DB" -v ON_ERROR_STOP=1 <<SQL >/dev/null
SET session_replication_role = replica;
CREATE TEMP TABLE stage_buildings (id bigint, owner_id bigint) ON COMMIT DROP;
\copy stage_buildings(id, owner_id) FROM '/tmp/restore_buildings.csv' WITH CSV;
INSERT INTO dune.buildings (id, owner_id)
SELECT s.id, s.owner_id
FROM stage_buildings s
WHERE NOT EXISTS (
  SELECT 1 FROM dune.buildings l
  WHERE l.id = s.id
);
DROP TABLE stage_buildings;
SET session_replication_role = DEFAULT;
SQL
}

# Run the restores for the affected tables.
restore_buildings
restore_map_areas
restore_player_respawn_locations
restore_player_tags
restore_recovered_vehicles
restore_player_access_codes

echo

echo '== Final counts ==' 
for tbl in buildings map_areas player_respawn_locations player_tags recovered_vehicles player_access_codes; do
  count=$(docker exec -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" psql -U "$PGUSER" -h "$PGHOST" -d "$LIVE_DB" -Atqc "SELECT count(*) FROM dune.${tbl}" 2>/dev/null | tr -d '[:space:]')
  echo "$tbl|$count"
done
