from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from db.models import Base

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv(
    "DUNE_DASHBOARD_DB_URL",
    f"sqlite+aiosqlite:///{(Path(__file__).resolve().parents[1] / 'dashboard.db').as_posix()}",
)

engine = create_async_engine(DATABASE_URL, future=True, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


# Lightweight column-additive migrations for SQLite. Each entry is
# (table_name, column_name, ALTER TABLE clause). Safe to run repeatedly
# because we PRAGMA-check existence first.
_PENDING_MIGRATIONS: list[tuple[str, str, str]] = [
    (
        "discord_webhooks",
        "notify_system",
        "ALTER TABLE discord_webhooks ADD COLUMN notify_system BOOLEAN NOT NULL DEFAULT 1",
    ),
    (
        "discord_webhooks",
        "notify_backup",
        "ALTER TABLE discord_webhooks ADD COLUMN notify_backup BOOLEAN NOT NULL DEFAULT 1",
    ),
    (
        "discord_webhooks",
        "notify_scheduled_restart",
        "ALTER TABLE discord_webhooks ADD COLUMN notify_scheduled_restart BOOLEAN NOT NULL DEFAULT 1",
    ),
    (
        "discord_webhooks",
        "notify_admin_action",
        "ALTER TABLE discord_webhooks ADD COLUMN notify_admin_action BOOLEAN NOT NULL DEFAULT 1",
    ),
    (
        "discord_webhooks",
        "notify_resource",
        "ALTER TABLE discord_webhooks ADD COLUMN notify_resource BOOLEAN NOT NULL DEFAULT 1",
    ),
]


# Data-only migrations (run after schema migrations). Each entry is
# (sentinel_table, idempotency-check SQL returning a non-zero count when the
# migration has already been applied, mutation SQL).
_PENDING_DATA_MIGRATIONS: list[tuple[str, str, str]] = [
    (
        "discord_webhooks",
        # If any per-category column disagrees with notify_system, treat the
        # data migration as still-needed. Once they're aligned, this returns 0.
        "SELECT count(*) FROM discord_webhooks WHERE "
        "notify_backup <> notify_system OR "
        "notify_scheduled_restart <> notify_system OR "
        "notify_admin_action <> notify_system OR "
        "notify_resource <> notify_system",
        # Copy the legacy umbrella flag into all 4 new per-category flags so
        # existing subscribers keep getting these alerts after the upgrade.
        "UPDATE discord_webhooks SET "
        "notify_backup = notify_system, "
        "notify_scheduled_restart = notify_system, "
        "notify_admin_action = notify_system, "
        "notify_resource = notify_system "
        "WHERE notify_backup <> notify_system OR notify_scheduled_restart <> notify_system "
        "OR notify_admin_action <> notify_system OR notify_resource <> notify_system",
    ),
]


async def _apply_pending_migrations() -> None:
    """Apply ALTER TABLE migrations idempotently. SQLAlchemy's create_all does
    not add columns to existing tables, so we patch in new columns by hand."""
    async with engine.begin() as conn:
        for table, column, ddl in _PENDING_MIGRATIONS:
            existing_table = await conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"),
                {"t": table},
            )
            if existing_table.first() is None:
                continue  # create_all will provision the column with the table itself
            cols = await conn.execute(text(f"PRAGMA table_info({table})"))
            names = {row[1] for row in cols.fetchall()}
            if column in names:
                continue
            logger.info("Adding missing column %s.%s via ALTER TABLE", table, column)
            await conn.execute(text(ddl))
        # Data migrations after schema is in place.
        for table, check_sql, mutate_sql in _PENDING_DATA_MIGRATIONS:
            existing_table = await conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"),
                {"t": table},
            )
            if existing_table.first() is None:
                continue
            pending = await conn.execute(text(check_sql))
            row = pending.first()
            count = int(row[0]) if row else 0
            if count == 0:
                continue
            logger.info("Applying data migration on %s: %d rows need updating", table, count)
            await conn.execute(text(mutate_sql))


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _apply_pending_migrations()


async def dispose_db() -> None:
    await engine.dispose()


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
