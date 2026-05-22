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


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
    log = logging.getLogger("dune-db-bootstrap")

    if not database_exists():
        log.info("Creating database %s", DATABASE)
        create_database()

    if schema_initialized():
        log.info("Schema %s already exists in %s", SCHEMA, DATABASE)
        with psycopg2.connect(
            host=HOST, port=PORT, database=DATABASE, user=USER, password=PASSWORD
        ) as conn:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute(
                    f'ALTER DATABASE "{DATABASE}" SET search_path TO {SCHEMA}, public'
                )
        return 0

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

    log.info("Database bootstrap complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
