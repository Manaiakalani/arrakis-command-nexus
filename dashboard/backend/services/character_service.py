from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# Known Dune Awakening character stats
EDITABLE_STATS = [
    {"key": "max_health", "label": "Max Health", "type": "number", "category": "stats"},
    {"key": "hydration", "label": "Hydration", "type": "number", "category": "stats"},
    {"key": "heat_exhaustion", "label": "Heat Exhaustion", "type": "number", "category": "stats"},
    {"key": "spice_level", "label": "Spice Level", "type": "number", "category": "stats"},
    {"key": "eyes_of_ibad", "label": "Eyes of Ibad", "type": "number", "category": "stats"},
    {"key": "addiction", "label": "Spice Addiction", "type": "number", "category": "stats"},
    {"key": "solari", "label": "Solari", "type": "number", "category": "economy"},
    {"key": "house_scrip", "label": "House Scrip", "type": "number", "category": "economy"},
    {"key": "combat_level", "label": "Combat Level", "type": "number", "category": "specialization"},
    {"key": "combat_xp", "label": "Combat XP", "type": "number", "category": "specialization"},
    {"key": "crafting_level", "label": "Crafting Level", "type": "number", "category": "specialization"},
    {"key": "crafting_xp", "label": "Crafting XP", "type": "number", "category": "specialization"},
    {"key": "exploration_level", "label": "Exploration Level", "type": "number", "category": "specialization"},
    {"key": "exploration_xp", "label": "Exploration XP", "type": "number", "category": "specialization"},
    {"key": "gathering_level", "label": "Gathering Level", "type": "number", "category": "specialization"},
    {"key": "gathering_xp", "label": "Gathering XP", "type": "number", "category": "specialization"},
    {"key": "sabotage_level", "label": "Sabotage Level", "type": "number", "category": "specialization"},
    {"key": "sabotage_xp", "label": "Sabotage XP", "type": "number", "category": "specialization"},
    {"key": "atreides_rep", "label": "Atreides Reputation", "type": "number", "category": "faction"},
    {"key": "harkonnen_rep", "label": "Harkonnen Reputation", "type": "number", "category": "faction"},
    {"key": "smuggler_rep", "label": "Smuggler Reputation", "type": "number", "category": "faction"},
]


class CharacterService:
    TABLE_CANDIDATES = ("encrypted_player_state", "encrypted_accounts", "characters", "players", "accounts")
    ID_COLUMNS = ("id", "account_id", "character_id", "player_id", "steam_id")
    NAME_COLUMNS = ("user", "name", "character_name", "player_name", "display_name", "username")
    TIMESTAMP_COLUMNS = ("last_login_time", "last_avatar_activity", "updated_at", "modified_at", "last_seen", "last_login", "created_at")
    METADATA_COLUMNS = ("online_status", "life_state", "server_id", "guild", "clan", "house", "faction", "level", "world_name", "map_name", "platform_name")

    def __init__(self, postgres_service: Any | None = None) -> None:
        self.postgres_service = postgres_service
        self.mutations_enabled = os.getenv("DUNE_ADMIN_MUTATIONS_ENABLED", "false").lower() == "true"
        self._editable_keys = {stat["key"] for stat in EDITABLE_STATS}
        self._mock_lock = asyncio.Lock()
        self._mock_characters = self._build_mock_characters()

    async def list_characters(self) -> list[dict[str, Any]]:
        """List all characters. Returns mock data if game DB not accessible."""
        if self.postgres_service and getattr(self.postgres_service, "pool", None) is not None:
            try:
                characters = await self._query_game_characters()
                if characters:
                    return characters
            except Exception as exc:  # noqa: BLE001
                logger.debug("Game DB character query failed: %s", exc)

        return await self._get_mock_characters()

    async def _query_game_characters(self) -> list[dict[str, Any]]:
        """Query game database for character data from Funcom schema."""
        pool = getattr(self.postgres_service, "pool", None)
        if pool is None:
            raise LookupError("Game DB pool is not available")

        async with pool.acquire() as connection:
            # Try direct Funcom schema query first
            try:
                rows = await connection.fetch("""
                    SELECT
                        CAST(ea.id AS TEXT) AS id,
                        ea."user" AS funcom_id,
                        eps.online_status::text AS online_status,
                        eps.life_state::text AS life_state,
                        eps.server_id,
                        eps.last_login_time,
                        eps.last_avatar_activity,
                        a.map,
                        a.transform,
                        ea.platform_name,
                        COALESCE(pvcb.balance, 0) AS solari
                    FROM dune.encrypted_accounts ea
                    JOIN dune.encrypted_player_state eps ON eps.account_id = ea.id
                    LEFT JOIN dune.actors a ON a.id = eps.player_pawn_id
                    LEFT JOIN dune.player_virtual_currency_balances pvcb
                        ON pvcb.player_controller_id = eps.player_controller_id
                        AND pvcb.currency_id = 1
                    ORDER BY eps.last_login_time DESC NULLS LAST
                    LIMIT 250
                """)
                if rows:
                    return [self._funcom_row_to_character(row) for row in rows]
            except Exception as exc:  # noqa: BLE001
                logger.debug("Funcom schema query failed, falling back: %s", exc)

            # Fallback to generic table discovery
            rows = await connection.fetch(
                """
                SELECT table_schema, table_name
                FROM information_schema.tables
                WHERE table_type = 'BASE TABLE'
                  AND table_schema NOT IN ('information_schema', 'pg_catalog')
                  AND lower(table_name) = ANY($1::text[])
                """,
                list(self.TABLE_CANDIDATES),
            )
            if not rows:
                raise LookupError("No character-like tables found")

            ordered_rows = sorted(
                rows,
                key=lambda row: (
                    self.TABLE_CANDIDATES.index(row["table_name"].lower()) if row["table_name"].lower() in self.TABLE_CANDIDATES else 999,
                    row["table_schema"],
                    row["table_name"],
                ),
            )
            for row in ordered_rows:
                characters = await self._query_table_characters(connection, row["table_schema"], row["table_name"])
                if characters:
                    return characters

        raise LookupError("No readable character data found")

    def _funcom_row_to_character(self, row: Any) -> dict[str, Any]:
        """Convert a Funcom DB row into our character format."""
        pos = None
        map_name = row.get("map")
        transform = row.get("transform")
        if transform is not None:
            try:
                # transform is a composite type: ((x,y,z),(qx,qy,qz,qw))
                t_str = str(transform)
                import re
                nums = re.findall(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?', t_str)
                if len(nums) >= 3:
                    pos = {"x": float(nums[0]), "y": float(nums[1]), "z": float(nums[2])}
            except Exception:
                pass

        stats: dict[str, Any] = {"solari": int(row.get("solari", 0))}
        metadata: dict[str, Any] = {}
        if row.get("online_status"):
            metadata["online_status"] = row["online_status"]
        if row.get("life_state"):
            metadata["life_state"] = row["life_state"]
        if row.get("platform_name"):
            metadata["platform"] = row["platform_name"]
        if map_name:
            metadata["map"] = map_name
        if pos:
            metadata["position"] = pos

        return {
            "id": str(row["id"]),
            "name": f"Player {row['id']}" if not row.get("funcom_id") else row["funcom_id"],
            "source": "funcom",
            "table": "dune.encrypted_player_state",
            "lastUpdated": self._serialize_value(row.get("last_login_time") or row.get("last_avatar_activity")),
            "stats": stats,
            "metadata": metadata,
        }

    async def get_character(self, character_id: str) -> dict[str, Any] | None:
        """Get a specific character by ID."""
        chars = await self.list_characters()
        return next((c for c in chars if c.get("id") == character_id), None)

    async def update_character(self, character_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        """Update character stats. Requires DUNE_ADMIN_MUTATIONS_ENABLED=true."""
        if not self.mutations_enabled:
            raise PermissionError("Character mutations are disabled. Set DUNE_ADMIN_MUTATIONS_ENABLED=true")

        existing_character = await self.get_character(character_id)
        if existing_character is None:
            raise KeyError(character_id)

        sanitized = self._sanitize_updates(updates)
        if self.postgres_service and getattr(self.postgres_service, "pool", None) is not None:
            try:
                updated = await self._update_game_character(character_id, sanitized)
                if updated is not None:
                    return updated
            except NotImplementedError:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.warning("Character update failed for %s: %s", character_id, exc)

        async with self._mock_lock:
            for index, character in enumerate(self._mock_characters):
                if character.get("id") != character_id:
                    continue
                next_character = self._clone_character(character)
                next_character.setdefault("stats", {}).update(sanitized)
                next_character["lastUpdated"] = self._serialize_value(datetime.now(timezone.utc))
                self._mock_characters[index] = next_character
                return self._clone_character(next_character)

        raise NotImplementedError("Character mutations require game DB schema mapping")

    def get_editable_stats(self) -> list[dict[str, str]]:
        return EDITABLE_STATS

    def get_summary(self) -> dict[str, Any]:
        return {
            "mutationsEnabled": self.mutations_enabled,
            "editableStats": len(EDITABLE_STATS),
            "categories": ["stats", "economy", "specialization", "faction"],
        }

    async def _query_table_characters(self, connection: Any, schema: str, table: str) -> list[dict[str, Any]]:
        columns = await self._get_table_columns(connection, schema, table)
        normalized = {column.lower(): column for column in columns}

        id_column = self._pick_column(normalized, self.ID_COLUMNS)
        name_column = self._pick_column(normalized, self.NAME_COLUMNS)
        timestamp_column = self._pick_column(normalized, self.TIMESTAMP_COLUMNS)
        stat_columns = {stat["key"]: normalized[stat["key"]] for stat in EDITABLE_STATS if stat["key"] in normalized}
        metadata_columns = {
            column: normalized[column]
            for column in self.METADATA_COLUMNS
            if column in normalized and normalized[column] not in {id_column, name_column, timestamp_column}
        }

        if not id_column and not name_column:
            return []

        aliases: list[tuple[str, str]] = []
        for alias, column in (
            ("id", id_column),
            ("name", name_column),
            ("last_updated", timestamp_column),
            *[(key, value) for key, value in metadata_columns.items()],
            *[(key, value) for key, value in stat_columns.items()],
        ):
            if column:
                aliases.append((alias, column))

        select_clause = ", ".join(f"{self._quote_ident(column)} AS {self._quote_ident(alias)}" for alias, column in aliases)
        order_clause = f" ORDER BY {self._quote_ident(timestamp_column)} DESC NULLS LAST" if timestamp_column else ""
        query = f"SELECT {select_clause} FROM {self._table_ref(schema, table)}{order_clause} LIMIT 250"
        rows = await connection.fetch(query)
        return [self._row_to_character(dict(row), schema, table, index + 1) for index, row in enumerate(rows)]

    async def _update_game_character(self, character_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        if not updates:
            character = await self.get_character(character_id)
            if character is None:
                raise KeyError(character_id)
            return character

        pool = getattr(self.postgres_service, "pool", None)
        if pool is None:
            return None

        async with pool.acquire() as connection:
            rows = await connection.fetch(
                """
                SELECT table_schema, table_name
                FROM information_schema.tables
                WHERE table_type = 'BASE TABLE'
                  AND table_schema NOT IN ('information_schema', 'pg_catalog')
                  AND lower(table_name) = ANY($1::text[])
                """,
                list(self.TABLE_CANDIDATES),
            )
            for row in rows:
                columns = await self._get_table_columns(connection, row["table_schema"], row["table_name"])
                normalized = {column.lower(): column for column in columns}
                id_column = self._pick_column(normalized, self.ID_COLUMNS)
                if not id_column:
                    continue

                matched_updates = {key: updates[key] for key in updates if key in normalized}
                if not matched_updates:
                    continue

                set_parts = []
                values: list[Any] = []
                for key, value in matched_updates.items():
                    values.append(value)
                    set_parts.append(f"{self._quote_ident(normalized[key])} = ${len(values)}")
                values.append(character_id)

                query = (
                    f"UPDATE {self._table_ref(row['table_schema'], row['table_name'])} "
                    f"SET {', '.join(set_parts)} "
                    f"WHERE CAST({self._quote_ident(id_column)} AS TEXT) = ${len(values)}"
                )
                status = await connection.execute(query, *values)
                if status.startswith("UPDATE 1"):
                    refreshed = await self._query_table_characters(connection, row["table_schema"], row["table_name"])
                    return next((item for item in refreshed if item.get("id") == character_id), None)

        raise NotImplementedError("Character mutations require game DB schema mapping")

    async def _get_mock_characters(self) -> list[dict[str, Any]]:
        async with self._mock_lock:
            return [self._clone_character(character) for character in self._mock_characters]

    async def _get_table_columns(self, connection: Any, schema: str, table: str) -> list[str]:
        rows = await connection.fetch(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
            """,
            schema,
            table,
        )
        return [row["column_name"] for row in rows]

    def _row_to_character(self, row: dict[str, Any], schema: str, table: str, index: int) -> dict[str, Any]:
        raw_name = row.get("name")
        raw_id = row.get("id")
        stats = {
            stat["key"]: self._serialize_value(row.get(stat["key"]))
            for stat in EDITABLE_STATS
            if row.get(stat["key"]) is not None
        }
        metadata = {
            key: self._serialize_value(row[key])
            for key in row
            if key not in {"id", "name", "last_updated", *self._editable_keys} and row.get(key) is not None
        }
        return {
            "id": str(raw_id or raw_name or f"{table}-{index}"),
            "name": str(raw_name or f"Character {index}"),
            "source": "game-db",
            "table": f"{schema}.{table}",
            "lastUpdated": self._serialize_value(row.get("last_updated")),
            "stats": stats,
            "metadata": metadata,
        }

    def _sanitize_updates(self, updates: dict[str, Any]) -> dict[str, Any]:
        sanitized: dict[str, Any] = {}
        for key, value in (updates or {}).items():
            if key not in self._editable_keys or value in (None, ""):
                continue
            if isinstance(value, bool):
                sanitized[key] = value
                continue
            if isinstance(value, (int, float)):
                sanitized[key] = value
                continue
            if isinstance(value, str):
                stripped = value.strip()
                if not stripped:
                    continue
                try:
                    sanitized[key] = float(stripped) if "." in stripped else int(stripped)
                except ValueError:
                    sanitized[key] = stripped
                continue
            sanitized[key] = value
        return sanitized

    def _build_mock_characters(self) -> list[dict[str, Any]]:
        timestamp = self._serialize_value(datetime.now(timezone.utc))
        return [
            {
                "id": "mock-chani",
                "name": "Chani",
                "source": "mock",
                "table": "mock.characters",
                "lastUpdated": timestamp,
                "stats": {
                    "max_health": 120,
                    "hydration": 88,
                    "heat_exhaustion": 12,
                    "spice_level": 55,
                    "eyes_of_ibad": 3,
                    "addiction": 11,
                    "solari": 42500,
                    "house_scrip": 180,
                    "combat_level": 18,
                    "combat_xp": 23800,
                    "crafting_level": 9,
                    "crafting_xp": 6200,
                    "exploration_level": 16,
                    "exploration_xp": 19400,
                    "gathering_level": 14,
                    "gathering_xp": 16150,
                    "sabotage_level": 7,
                    "sabotage_xp": 4100,
                    "atreides_rep": 42,
                    "harkonnen_rep": -18,
                    "smuggler_rep": 33,
                },
                "metadata": {"house": "Fremen", "clan": "Sietch Tabr", "level": 24},
            },
            {
                "id": "mock-gurney",
                "name": "Gurney Halleck",
                "source": "mock",
                "table": "mock.characters",
                "lastUpdated": timestamp,
                "stats": {
                    "max_health": 165,
                    "hydration": 74,
                    "heat_exhaustion": 9,
                    "spice_level": 38,
                    "eyes_of_ibad": 1,
                    "addiction": 4,
                    "solari": 98250,
                    "house_scrip": 920,
                    "combat_level": 27,
                    "combat_xp": 44510,
                    "crafting_level": 13,
                    "crafting_xp": 10400,
                    "exploration_level": 11,
                    "exploration_xp": 7800,
                    "gathering_level": 10,
                    "gathering_xp": 7050,
                    "sabotage_level": 8,
                    "sabotage_xp": 5300,
                    "atreides_rep": 68,
                    "harkonnen_rep": -55,
                    "smuggler_rep": 8,
                },
                "metadata": {"house": "Atreides", "clan": "Warmasters", "level": 31},
            },
        ]

    def _clone_character(self, character: dict[str, Any]) -> dict[str, Any]:
        return {
            **character,
            "stats": dict(character.get("stats") or {}),
            "metadata": dict(character.get("metadata") or {}),
        }

    def _pick_column(self, columns: dict[str, str], candidates: tuple[str, ...]) -> str | None:
        for candidate in candidates:
            if candidate in columns:
                return columns[candidate]
        return None

    def _serialize_value(self, value: Any) -> Any:
        if isinstance(value, datetime):
            dt = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
            return dt.isoformat()
        if hasattr(value, "isoformat") and callable(value.isoformat):
            return value.isoformat()
        return value

    def _quote_ident(self, value: str) -> str:
        return '"' + value.replace('"', '""') + '"'

    def _table_ref(self, schema: str, table: str) -> str:
        return f"{self._quote_ident(schema)}.{self._quote_ident(table)}"
