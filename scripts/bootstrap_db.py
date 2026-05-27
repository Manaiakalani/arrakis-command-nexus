#!/usr/bin/env python3
"""Bootstrap the Dune Awakening database.

Creates the 'dune' role and database if they do not exist, then runs
Funcom's schema setup via the ToolsDB utilities bundled in the
seabass-server-db-utils image.
"""
import logging
import os
import pathlib
import sys

import psycopg2

from funcomdb.config import Connection, Credentials
from ToolsDB.settings import Settings
from ToolsDB.setupdb import setupdb

HOST = os.environ.get("DB_HOST", "postgres")
PORT = int(os.environ.get("DB_PORT", "5432"))
ADMIN_DATABASE = "postgres"
DATABASE = "dune_sb_1_4_0_0"
USER = "dune"
PASSWORD = os.environ.get("POSTGRES_DUNE_PASSWORD", "change-me-dune-db")
SCHEMA = "dune"
SCHEMA_PATH = pathlib.Path("/root/DuneSandbox/Database")

# Canonical partition definitions seeded from Funcom's world-template.yaml.
# The "type": "box2d_array" wrapper is required -- without it the game server
# binary raises: Ensure condition failed: Object->HasTypedField<EJson::String>(u"type")
# and never transitions to ready.
PARTITION_DEF = '{"type":"box2d_array","box":{"min_x":0,"min_y":0,"max_x":1,"max_y":1}}'
WORLD_PARTITIONS = [
    (1, "Survival_1"),
    (2, "Overmap"),
    (3, "SH_Arrakeen"),
    (4, "SH_HarkoVillage"),
    (5, "CB_Story_Hephaestus"),
    (6, "CB_Story_Ecolab_Carthag"),
    (7, "CB_Story_WaterFatManor"),
    (8, "DeepDesert_1"),
    (9, "Story_ProcesVerbal"),
    (10, "DLC_Story_LostHarvest_EcolabA"),
    (11, "DLC_Story_LostHarvest_EcolabB"),
    (12, "DLC_Story_LostHarvest_ForgottenLab"),
    (13, "Story_ArtOfKanly"),
]


def database_exists() -> bool:
    conn = psycopg2.connect(
        host=HOST, port=PORT, database=ADMIN_DATABASE, user=USER, password=PASSWORD
    )
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DATABASE,))
            return cur.fetchone() is not None
    finally:
        conn.close()


def create_database() -> None:
    conn = psycopg2.connect(
        host=HOST, port=PORT, database=ADMIN_DATABASE, user=USER, password=PASSWORD
    )
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(f'CREATE DATABASE "{DATABASE}" OWNER "{USER}"')
    finally:
        conn.close()


def schema_initialized() -> bool:
    with psycopg2.connect(
        host=HOST, port=PORT, database=DATABASE, user=USER, password=PASSWORD
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM information_schema.schemata WHERE schema_name = %s",
                (SCHEMA,),
            )
            return cur.fetchone() is not None


def seed_world_partitions(log: logging.Logger) -> None:
    """Insert canonical world_partition rows if the table is empty."""
    with psycopg2.connect(
        host=HOST, port=PORT, database=DATABASE, user=USER, password=PASSWORD,
        options=f"-c search_path={SCHEMA},public",
    ) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM world_partition")
            count = cur.fetchone()[0]
            if count > 0:
                log.info("world_partition already has %d rows, skipping seed", count)
                return

            for pid, map_name in WORLD_PARTITIONS:
                cur.execute(
                    "INSERT INTO world_partition "
                    "(partition_id, server_id, map, partition_definition, dimension_index, blocked, label) "
                    "VALUES (%s, NULL, %s, %s::jsonb, 0, false, NULL)",
                    (pid, map_name, PARTITION_DEF),
                )
            cur.execute(
                "SELECT setval('world_partition_partition_id_seq', "
                "(SELECT max(partition_id) FROM world_partition))"
            )
            conn.commit()
            log.info("Seeded %d world_partition rows", len(WORLD_PARTITIONS))


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
    log = logging.getLogger("dune-db-bootstrap")

    if not database_exists():
        log.info("Creating database %s", DATABASE)
        create_database()

    if schema_initialized():
        log.info("Schema %s already exists in %s — running migrations", SCHEMA, DATABASE)
    else:
        log.info("Schema %s not found in %s — initialising fresh", SCHEMA, DATABASE)

    settings = Settings(
        bin_path=pathlib.Path("/usr/bin"),
        connection=Connection(host=HOST, port=PORT, timeout=30),
        user_credentials=Credentials(user=USER, password=PASSWORD, database=DATABASE),
        admin_credentials=Credentials(
            user=USER, password=PASSWORD, database=ADMIN_DATABASE
        ),
        schema_name=SCHEMA,
        module_path=SCHEMA_PATH,
        tables_to_dump=["applied_patches"],
        extra_schema_names=["ext"],
    )

    if not setupdb(log, settings):
        return 1

    with psycopg2.connect(
        host=HOST, port=PORT, database=DATABASE, user=USER, password=PASSWORD
    ) as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                f'ALTER DATABASE "{DATABASE}" SET search_path TO {SCHEMA}, public'
            )

    seed_world_partitions(log)

    log.info("Database bootstrap complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
