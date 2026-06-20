from __future__ import annotations

import logging
import os
from typing import Any

import asyncpg

from models.player import Player

logger = logging.getLogger(__name__)


class PostgresService:
    def __init__(self, dsn: str | None = None) -> None:
        self.dsn = (
            dsn
            or os.getenv("DUNE_FUNCOM_POSTGRES_DSN")
            or os.getenv("DUNE_POSTGRES_DSN")
            or os.getenv("DATABASE_URL")
        )
        self.pool: asyncpg.Pool | None = None
        self._query_warning_emitted = False

    async def start(self) -> None:
        if not self.dsn:
            logger.info("Funcom Postgres DSN not configured; player queries disabled.")
            return
        # asyncpg requires "postgresql://" scheme, but DATABASE_URL often uses "postgres://"
        dsn = self.dsn
        if dsn.startswith("postgres://"):
            dsn = dsn.replace("postgres://", "postgresql://", 1)
        try:
            self.pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=5, command_timeout=10)
            logger.info("Connected to Funcom Postgres (player queries enabled).")
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

        query = """
            SELECT
                CAST(ea."user" AS TEXT) AS steam_id,
                encode(eps.encrypted_character_name, 'escape') AS name,
                eps.online_status::text AS online_status,
                eps.life_state::text AS life_state,
                eps.server_id,
                eps.last_login_time AS session_start,
                ea.platform_name,
                COALESCE(a.map, fs.map) AS map_name,
                a.transform
            FROM dune.encrypted_player_state eps
            JOIN dune.encrypted_accounts ea ON ea.id = eps.account_id
            LEFT JOIN dune.actors a ON a.id = eps.player_pawn_id
            LEFT JOIN dune.farm_state fs ON fs.server_id = eps.server_id
            WHERE eps.online_status::text = 'Online'
            ORDER BY eps.last_login_time DESC
        """
        try:
            async with self.pool.acquire() as connection:
                rows = await connection.fetch(query)
        except asyncpg.PostgresError as exc:
            if not self._query_warning_emitted:
                logger.warning("Postgres player query failed: %s", exc)
                self._query_warning_emitted = True
            return []

        return [self._row_to_player(row) for row in rows]

    async def get_player_progress(self, steam_id: str) -> dict[str, Any]:
        if self.pool is None:
            return {}

        query = """
            SELECT
                COALESCE(SUM(pvcb.balance), 0) AS currency_balance
            FROM dune.encrypted_accounts ea
            JOIN dune.encrypted_player_state eps ON eps.account_id = ea.id
            LEFT JOIN dune.player_virtual_currency_balances pvcb
                ON pvcb.player_controller_id = eps.player_controller_id
            WHERE ea."user" = $1
        """
        try:
            async with self.pool.acquire() as connection:
                row = await connection.fetchrow(query, steam_id)
        except asyncpg.PostgresError as exc:
            logger.warning("get_player_progress query failed for steam_id=%s: %s", steam_id, exc)
            return {}
        return dict(row) if row else {}

    async def get_all_players(self) -> list[Player]:
        """Return all players (online and offline) with last login info."""
        if self.pool is None:
            return []

        query = """
            SELECT
                CAST(ea."user" AS TEXT) AS steam_id,
                encode(eps.encrypted_character_name, 'escape') AS name,
                eps.online_status::text AS online_status,
                eps.life_state::text AS life_state,
                eps.server_id,
                eps.last_login_time AS session_start,
                ea.platform_name,
                a.map AS map_name,
                a.transform
            FROM dune.encrypted_player_state eps
            JOIN dune.encrypted_accounts ea ON ea.id = eps.account_id
            LEFT JOIN dune.actors a ON a.id = eps.player_pawn_id
            ORDER BY eps.last_login_time DESC
        """
        try:
            async with self.pool.acquire() as connection:
                rows = await connection.fetch(query)
        except asyncpg.PostgresError as exc:
            logger.warning("Postgres all-players query failed: %s", exc)
            return []
        return [self._row_to_player(row) for row in rows]

    def _row_to_player(self, row: asyncpg.Record) -> Player:
        position = None
        if {"pos_x", "pos_y", "pos_z"}.issubset(set(row.keys())):
            position = {
                "x": float(row["pos_x"]),
                "y": float(row["pos_y"]),
                "z": float(row["pos_z"]),
            }
        elif "transform" in row.keys() and row["transform"] is not None:
            try:
                import re
                t_str = str(row["transform"])
                nums = re.findall(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?', t_str)
                if len(nums) >= 3:
                    position = {
                        "x": float(nums[0]),
                        "y": float(nums[1]),
                        "z": float(nums[2]),
                    }
            except Exception:
                pass

        return Player(
            steam_id=str(row.get("steam_id", "")),
            name=row.get("name") or row.get("steam_id") or "Unknown",
            map_name=row.get("map_name"),
            position=position,
            session_start=row.get("session_start"),
            is_online=row.get("online_status") == "Online" if "online_status" in row.keys() else bool(row.get("is_online", True)),
            life_state=row.get("life_state"),
            server_id=row.get("server_id"),
            platform=row.get("platform_name"),
        )
