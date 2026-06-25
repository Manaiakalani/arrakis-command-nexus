#!/usr/bin/env bash
set -euo pipefail
backup=/tmp/dune-db-pre-reset.dump
live_db=dune_sb_1_4_0_0
compare_db=dune_restore_probe

for tbl in $(docker exec dune-awakening-postgres-1 pg_restore -l "$backup" | grep -E ' TABLE ' | sed -E 's/.* TABLE [^ ]+ ([^ ]+).*/\1/' | sort -u); do
  if docker exec -e PGPASSWORD='REDACTED_DB_PASSWORD' dune-awakening-postgres-1 psql -U dune -h localhost -d "$live_db" -tAc "SELECT to_regclass('dune.${tbl}') IS NOT NULL" | grep -q t; then
    live_count=$(docker exec -e PGPASSWORD='REDACTED_DB_PASSWORD' dune-awakening-postgres-1 psql -U dune -h localhost -d "$live_db" -tAc "SELECT COALESCE((SELECT count(*) FROM dune.${tbl}), 0)" | tr -d '[:space:]')
    backup_count=$(docker exec -e PGPASSWORD='REDACTED_DB_PASSWORD' dune-awakening-postgres-1 psql -U dune -h localhost -d "$compare_db" -tAc "SELECT COALESCE((SELECT count(*) FROM dune.${tbl}), 0)" | tr -d '[:space:]')
    if [ "$live_count" = "0" ] && [ "$backup_count" != "0" ]; then
      echo "$tbl|$live_count|$backup_count"
    fi
  fi
done
