from __future__ import annotations

import logging
import os
from typing import Any

import asyncpg

from models.player import Player

logger = logging.getLogger(__name__)


class PostgresService:
    def __init__(self, dsn: str | None = None) -> None:
        self.dsn = dsn or os.getenv("DUNE_FUNCOM_POSTGRES_DSN") or os.getenv("DUNE_POSTGRES_DSN")
        self.pool: asyncpg.Pool | None = None
        self._query_warning_emitted = False

    async def start(self) -> None:
        if not self.dsn:
            logger.info("Funcom Postgres DSN not configured; player queries disabled.")
            return
        try:
            self.pool = await asyncpg.create_pool(dsn=self.dsn, min_size=1, max_size=5, command_timeout=10)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not connect to Funcom Postgres: %s", exc)
            self.pool = None

    async def close(self) -> None:
        if self.pool is not None:
            await self.pool.close()
            self.pool = None

    async def get_online_players(self) -> list[Player]:
        if self.pool is None:
            return []

        # Placeholder query: the actual Funcom schema table/view names depend on the
        # server version. Update the table name and columns once confirmed for your build.
        query = """
            SELECT
                CAST(player_id AS TEXT) AS steam_id,
                player_name AS name,
                world_name AS map_name,
                pos_x,
                pos_y,
                pos_z,
                session_start,
                TRUE AS is_online
            FROM online_players_view
            ORDER BY session_start DESC
        """
        try:
            async with self.pool.acquire() as connection:
                rows = await connection.fetch(query)
        except asyncpg.PostgresError as exc:
            if not self._query_warning_emitted:
                logger.warning("Postgres player query needs schema updates: %s", exc)
                self._query_warning_emitted = True
            return []

        return [self._row_to_player(row) for row in rows]

    async def get_player_progress(self, steam_id: str) -> dict[str, Any]:
        if self.pool is None:
            return {}

        # Placeholder query: adjust table/columns to match Funcom's proprietary schema.
        query = """
            SELECT currency_balance, experience_points
            FROM player_progress_view
            WHERE CAST(player_id AS TEXT) = $1
        """
        try:
            async with self.pool.acquire() as connection:
                row = await connection.fetchrow(query, steam_id)
        except asyncpg.PostgresError:
            return {}
        return dict(row) if row else {}

    def _row_to_player(self, row: asyncpg.Record) -> Player:
        position = None
        if {"pos_x", "pos_y", "pos_z"}.issubset(set(row.keys())):
            position = {
                "x": float(row["pos_x"]),
                "y": float(row["pos_y"]),
                "z": float(row["pos_z"]),
            }
        return Player(
            steam_id=str(row.get("steam_id", "")),
            name=row.get("name") or "Unknown",
            map_name=row.get("map_name"),
            position=position,
            session_start=row.get("session_start"),
            is_online=bool(row.get("is_online", True)),
        )
