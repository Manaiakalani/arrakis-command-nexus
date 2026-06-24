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
    {"key": "current_hydration", "label": "Hydration", "type": "number", "category": "stats"},
    {"key": "heat_exhaustion", "label": "Heat Exhaustion", "type": "number", "category": "stats"},
    {"key": "dehydration_penalty", "label": "Dehydration Penalty", "type": "number", "category": "stats"},
    {"key": "clothing_captured_water", "label": "Clothing Captured Water", "type": "number", "category": "stats"},
    {"key": "current_spice", "label": "Spice", "type": "number", "category": "spice"},
    {"key": "spice_exposure", "label": "Spice Exposure", "type": "number", "category": "spice"},
    {"key": "spice_tolerance", "label": "Spice Tolerance", "type": "number", "category": "spice"},
    {"key": "spice_addiction_level", "label": "Spice Addiction Level", "type": "number", "category": "spice"},
    {"key": "eyes_of_ibad", "label": "Eyes of Ibad", "type": "number", "category": "spice"},
    {"key": "solari", "label": "Solari (Currency)", "type": "number", "category": "economy"},
    {"key": "tech_knowledge_points", "label": "Tech Knowledge Points", "type": "number", "category": "specialization"},
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
                        encode(eps.encrypted_character_name, 'escape') AS character_name,
                        eps.online_status::text AS online_status,
                        eps.life_state::text AS life_state,
                        eps.server_id,
                        eps.last_login_time,
                        eps.last_avatar_activity,
                        a.map,
                        a.transform,
                        ea.platform_name,
                        COALESCE(pvcb.balance, 0) AS solari,
                        a.gas_attributes,
                        a.properties->'DamageableActorComponent' AS health_data,
                        a.properties->'BP_DunePlayerCharacter_C' AS character_data,
                        a.properties->'TechKnowledgePlayerComponent' AS tech_data
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
                raise LookupError("No character data found on this server")

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
        import json
        import re

        pos = None
        map_name = row.get("map")
        transform = row.get("transform")
        if transform is not None:
            try:
                t_str = str(transform)
                nums = re.findall(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?', t_str)
                if len(nums) >= 3:
                    pos = {"x": float(nums[0]), "y": float(nums[1]), "z": float(nums[2])}
            except Exception:
                pass

        # Extract stats from gas_attributes and properties JSON
        stats: dict[str, Any] = {"solari": int(row.get("solari", 0))}

        # Health from DamageableActorComponent
        health_data = row.get("health_data")
        if health_data:
            if isinstance(health_data, str):
                health_data = json.loads(health_data)
            stats["max_health"] = health_data.get("m_TotalMaxHealth", 0)

        # Gas attributes (hydration, spice, etc)
        gas = row.get("gas_attributes")
        if gas:
            if isinstance(gas, str):
                gas = json.loads(gas)
            hydration_set = gas.get("DuneHydrationAttributeSet", {})
            stats["current_hydration"] = hydration_set.get("CurrentHydration", {}).get("CurrentValue", 0)
            stats["heat_exhaustion"] = hydration_set.get("HeatExhaustion", {}).get("CurrentValue", 0)
            stats["dehydration_penalty"] = hydration_set.get("DehydrationPenalty", {}).get("CurrentValue", 0)
            stats["clothing_captured_water"] = hydration_set.get("ClothingCapturedWater", {}).get("CurrentValue", 0)

            spice_set = gas.get("DuneSpiceAddictionAttributeSet", {})
            stats["current_spice"] = spice_set.get("CurrentSpice", {}).get("CurrentValue", 0)
            stats["spice_exposure"] = spice_set.get("SpiceExposure", {}).get("CurrentValue", 0)
            stats["spice_tolerance"] = spice_set.get("SpiceTolerance", {}).get("CurrentValue", 0)
            stats["spice_addiction_level"] = spice_set.get("SpiceAddictionLevel", {}).get("CurrentValue", 0)

        # Character properties (eyes of ibad, etc)
        char_data = row.get("character_data")
        if char_data:
            if isinstance(char_data, str):
                char_data = json.loads(char_data)
            stats["eyes_of_ibad"] = char_data.get("m_EyesOfIbadValue", 0)

        # Tech knowledge points
        tech_data = row.get("tech_data")
        if tech_data:
            if isinstance(tech_data, str):
                tech_data = json.loads(tech_data)
            stats["tech_knowledge_points"] = tech_data.get("m_TechKnowledgePoints", 0)

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
            "name": row.get("character_name") or row.get("funcom_id") or f"Player {row['id']}",
            "source": "funcom",
            "table": "player-state",
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

    async def get_inventory(self, character_id: str) -> dict[str, Any]:
        """Get items from the player character actor's inventories only."""
        pool = getattr(self.postgres_service, "pool", None) if self.postgres_service else None
        if pool is None:
            return {"character_id": character_id, "inventories": []}

        account_id = int(character_id)
        async with pool.acquire() as connection:
            rows = await connection.fetch("""
                SELECT
                    it.template_id,
                    it.stack_size,
                    it.position_index,
                    it.quality_level,
                    i.inventory_type,
                    it.stats AS item_stats
                FROM dune.items it
                JOIN dune.inventories i ON i.id = it.inventory_id
                WHERE i.actor_id IN (
                    SELECT id FROM dune.actors
                    WHERE owner_account_id = $1
                      AND class LIKE '%PlayerCharacter%'
                )
                ORDER BY i.inventory_type, it.position_index
            """, account_id)

        inv_type_names = {
            0: "backpack", 1: "equipment", 12: "quest",
            14: "emotes", 15: "hotbar", 20: "crafting_queue",
            25: "ammo", 27: "emote_wheel", 29: "unknown_29",
            30: "unknown_30", 31: "unknown_31", 32: "unknown_32",
            33: "unknown_33",
        }
        grouped: dict[str, list] = {}
        for row in rows:
            inv_name = inv_type_names.get(row["inventory_type"], f"type_{row['inventory_type']}")
            grouped.setdefault(inv_name, []).append({
                "template_id": row["template_id"],
                "stack_size": int(row["stack_size"]),
                "position_index": int(row["position_index"]),
                "quality_level": int(row["quality_level"]),
            })

        return {"character_id": character_id, "inventories": grouped}

    async def grant_item(
        self,
        character_id: str,
        template_id: str,
        stack_size: int = 1,
        quality_level: int = 0,
    ) -> dict[str, Any]:
        """Grant an item directly into a character's backpack inventory."""
        if not self.mutations_enabled:
            raise PermissionError("Mutations disabled. Set DUNE_ADMIN_MUTATIONS_ENABLED=true")

        if not 1 <= stack_size <= 10000:
            raise ValueError("stack_size must be between 1 and 10000")
        if not 0 <= quality_level <= 10:
            raise ValueError("quality_level must be between 0 and 10")

        pool = getattr(self.postgres_service, "pool", None) if self.postgres_service else None
        if pool is None:
            raise PermissionError("No database connection")

        account_id = int(character_id)
        async with pool.acquire() as connection:
            # Resolve the template to an actual ITEM template id. The game
            # instantiates inventory items by item template, NOT by crafting
            # recipe name. Granting a recipe/tier name (e.g.
            # "T2_Material_Silicone" or "T3_Material_CopperBar", whose produced
            # item templates are actually "Silicone" / "CopperBar") writes a row
            # the server cannot instantiate -- it becomes an invisible "ghost"
            # slot in-game. Resolve such names to the real item template. This
            # runs for catalog entries too, because the curated catalog contains
            # several tier-prefixed recipe names that would otherwise ghost.
            template_note: str | None = None
            item_exists = await connection.fetchval(
                "SELECT 1 FROM dune.items WHERE template_id = $1 LIMIT 1",
                template_id,
            )
            if not item_exists:
                # Resolve a recipe/tier-style name to its item template by
                # matching the trailing segment (T2_Material_Silicone ->
                # Silicone) against templates the game already renders.
                tail = template_id.rsplit("_", 1)[-1]
                resolved = None
                if tail and tail != template_id:
                    resolved = await connection.fetchval(
                        "SELECT template_id FROM dune.items "
                        "WHERE template_id ILIKE $1 ORDER BY template_id LIMIT 1",
                        tail,
                    )
                if resolved:
                    template_note = (
                        f"Resolved '{template_id}' to item template '{resolved}'. "
                        "(The original is a crafting-recipe/tier name, which the "
                        "game does not render directly as an item.)"
                    )
                    logger.info(
                        "grant_item resolved recipe-style template %s -> %s",
                        template_id, resolved,
                    )
                    template_id = resolved
                elif template_id in self.KNOWN_TEMPLATES:
                    # Curated catalog entry we cannot confirm against live items
                    # (e.g. an item no current player happens to hold). Trust the
                    # catalog and grant as-is.
                    pass
                else:
                    # Unknown free-text name. It may exist purely as a recipe
                    # name -- which does NOT render in-game -- so reject with
                    # clear guidance.
                    recipe_only = await connection.fetchval("""
                        SELECT EXISTS(
                            SELECT 1 FROM dune.actors,
                                jsonb_array_elements(
                                    properties->'CraftingRecipesLibraryActorComponent'->'m_KnownItemRecipes'
                                ) recipe
                            WHERE properties ? 'CraftingRecipesLibraryActorComponent'
                              AND recipe->'BaseRecipeId'->>'Name' ILIKE '%' || $1 || '%'
                        )
                    """, template_id)
                    if recipe_only:
                        raise ValueError(
                            f"'{template_id}' is a crafting-recipe name, not an item "
                            "template. Items render by item template id (e.g. "
                            "'Silicone', not 'T2_Material_Silicone'). Use the item "
                            "search to find the correct template id."
                        )
                    raise ValueError(
                        f"Unknown template '{template_id}'. "
                        "Use the item search to find valid template IDs."
                        )

            import json
            import time

            # Check whether the player is currently online. The game server
            # holds inventory in memory for online players and only WRITES it
            # back to the database during a session. It re-reads inventory rows
            # from the database when the player's character loads from
            # persistence -- which happens on LOGIN (LoadPlayerActors). A
            # directly inserted item therefore appears after the player relogs
            # (returns to the main menu and rejoins); a full server restart is
            # NOT required (a restart only works because it forces every player
            # to relog). Granting while online carries a small risk that the
            # logout flush rewrites the slot, so prefer granting at the menu.
            online_status = await connection.fetchval("""
                SELECT online_status::text FROM dune.encrypted_player_state
                WHERE account_id = $1
            """, account_id)
            player_online = (online_status or "").lower() == "online"

            warnings: list[str] = []
            if template_note:
                warnings.append(template_note)
            # The game server reads a player's inventory from the database when
            # their character loads from persistence, which happens on LOGIN.
            # A directly inserted item therefore appears after the player relogs
            # (returns to the main menu and rejoins) -- no server restart is
            # required. (A server restart works only because it forces every
            # player to relog.)
            warnings.append(
                "Item written to the database. It will appear in-game after the "
                "player relogs: have them return to the main menu and rejoin the "
                "server. On login the server loads the inventory from the "
                "database. A full server restart is NOT required."
            )
            if player_online:
                warnings.append(
                    "Player is currently ONLINE, so the item is not visible yet. "
                    "Have them log out to the main menu and log back in to load "
                    "it. Note: granting while online carries a small risk that the "
                    "server's logout flush rewrites the slot; if the item does not "
                    "appear after relogging, re-grant it while the player sits at "
                    "the main menu, then have them rejoin."
                )
                logger.warning(
                    "Granting item %s to account %d while player is ONLINE -- "
                    "item loads on the player's next relog; small risk the logout "
                    "flush rewrites the slot.",
                    template_id, account_id,
                )

            # Check the max stack size observed for this item type in the DB
            observed_max = await connection.fetchval("""
                SELECT MAX(stack_size) FROM dune.items WHERE template_id = $1
            """, template_id)
            if observed_max and stack_size > observed_max:
                warnings.append(
                    f"Requested stack_size {stack_size} exceeds the largest observed "
                    f"stack of {observed_max} for '{template_id}'. The game server may "
                    f"cap, split, or move oversized stacks to overflow inventory."
                )
                logger.warning(
                    "Grant stack_size %d exceeds observed max %d for %s (account %d)",
                    stack_size, observed_max, template_id, account_id,
                )
            warning = " ".join(warnings) if warnings else None

            # Copy stats from an existing item of the same type if available
            existing_stats = await connection.fetchval("""
                SELECT stats::text FROM dune.items
                WHERE template_id = $1 AND stats IS NOT NULL
                LIMIT 1
            """, template_id)

            if existing_stats:
                item_stats = json.loads(existing_stats)
            else:
                item_stats = {"FItemStackAndDurabilityStats": [[], {"DecayedMaxDurability": 0.0}]}

            # Find the player's backpack inventory (type 0)
            inv = await connection.fetchrow("""
                SELECT i.id AS inventory_id, i.max_item_count
                FROM dune.inventories i
                WHERE i.actor_id IN (
                    SELECT id FROM dune.actors WHERE owner_account_id = $1
                )
                AND i.inventory_type = 0
                LIMIT 1
            """, account_id)
            if inv is None:
                raise KeyError(character_id)

            inventory_id = inv["inventory_id"]
            # max_item_count is the number of slots the game renders for this
            # inventory (e.g. 35 for a default backpack). Items placed at a
            # position_index >= max_item_count live in the database but are
            # never shown in-game, which is why naive MAX(position_index)+1
            # grants silently fail to appear. Find the FIRST FREE slot within
            # the valid [0, max_item_count) range instead.
            slot_cap = inv["max_item_count"] or 35
            used_slots = await connection.fetch("""
                SELECT position_index
                FROM dune.items WHERE inventory_id = $1
            """, inventory_id)
            occupied = {int(r["position_index"]) for r in used_slots}
            free_slot: int | None = None
            for candidate in range(slot_cap):
                if candidate not in occupied:
                    free_slot = candidate
                    break
            if free_slot is None:
                raise ValueError(
                    f"Backpack is full ({len(occupied)}/{slot_cap} slots used). "
                    "Free up a slot in-game before granting more items."
                )
            max_pos = free_slot

            new_item_id = await connection.fetchval("""
                INSERT INTO dune.items
                    (inventory_id, template_id, stack_size, position_index,
                     quality_level, is_new, acquisition_time, stats)
                VALUES ($1, $2, $3, $4, $5, true, $6, $7::jsonb)
                RETURNING id
            """, inventory_id, template_id, stack_size, max_pos,
                quality_level, int(time.time()), json.dumps(item_stats))

            logger.info(
                "Granted item %s (x%d) to account %d, item_id=%d, inventory=%d, pos=%d",
                template_id, stack_size, account_id, new_item_id,
                inventory_id, max_pos,
            )
            result: dict[str, Any] = {
                "success": True,
                "item_id": int(new_item_id),
                "template_id": template_id,
                "stack_size": stack_size,
                "inventory_type": "backpack",
                "position_index": int(max_pos),
                "player_online": player_online,
            }
            if warning:
                result["warning"] = warning
            return result

    async def grant_solari(self, character_id: str, amount: int) -> dict[str, Any]:
        """Add solari coins to a character's backpack as SolarisCoin items."""
        if not self.mutations_enabled:
            raise PermissionError("Mutations disabled. Set DUNE_ADMIN_MUTATIONS_ENABLED=true")

        pool = getattr(self.postgres_service, "pool", None) if self.postgres_service else None
        if pool is None:
            raise PermissionError("No database connection")

        account_id = int(character_id)
        async with pool.acquire() as connection:
            # Find existing SolarisCoin stack in backpack
            existing = await connection.fetchrow("""
                SELECT it.id, it.stack_size
                FROM dune.items it
                JOIN dune.inventories i ON i.id = it.inventory_id
                WHERE i.actor_id IN (
                    SELECT id FROM dune.actors WHERE owner_account_id = $1
                )
                AND i.inventory_type = 0
                AND it.template_id = 'SolarisCoin'
                LIMIT 1
            """, account_id)

            if existing:
                new_balance = int(existing["stack_size"]) + amount
                await connection.execute("""
                    UPDATE dune.items SET stack_size = $1 WHERE id = $2
                """, new_balance, existing["id"])
                logger.info("Added %d solari to account %d (new total: %d)", amount, account_id, new_balance)
                return {"success": True, "solari_added": amount, "new_total": new_balance}
            else:
                # No existing stack, grant as new item
                result = await self.grant_item(character_id, "SolarisCoin", stack_size=amount)
                return {"success": True, "solari_added": amount, "new_total": amount, **result}

    async def teleport(self, character_id: str, x: float, y: float, z: float) -> dict[str, Any]:
        """Teleport a character by updating their actor transform. Takes effect on relog.

        Z-coordinate is auto-corrected to avoid underground spawns:
        the nearest known actor's Z is used as a floor (+ 500 buffer).
        """
        if not self.mutations_enabled:
            raise PermissionError("Mutations disabled. Set DUNE_ADMIN_MUTATIONS_ENABLED=true")

        pool = getattr(self.postgres_service, "pool", None) if self.postgres_service else None
        if pool is None:
            raise PermissionError("No database connection")

        async with pool.acquire() as connection:
            # character_id may be a numeric account_id or a hex FLS user ID
            try:
                account_id = int(character_id)
            except ValueError:
                # Look up account_id from the FLS user hex ID
                row = await connection.fetchrow(
                    'SELECT id FROM dune.encrypted_accounts WHERE "user" = $1',
                    character_id,
                )
                if row is None:
                    raise KeyError(character_id)
                account_id = row["id"]

            pawn = await connection.fetchrow("""
                SELECT eps.player_pawn_id
                FROM dune.encrypted_player_state eps
                WHERE eps.account_id = $1
            """, account_id)
            if pawn is None:
                raise KeyError(character_id)

            pawn_id = pawn["player_pawn_id"]

            # Smart Z: find nearest actor's Z to avoid underground teleport.
            # Terrain height varies wildly (274 to 3500+), so a fixed default
            # is unreliable.  We sample all actors with valid transforms,
            # compute 2D distance to the target, pick the closest, and use
            # its Z + 500 as a floor value.
            safe_z = await self._compute_safe_z(connection, pawn_id, x, y, z)

            # Update transform keeping existing rotation
            await connection.execute("""
                UPDATE dune.actors
                SET transform = ROW(
                    ROW($2, $3, $4)::vector,
                    (transform).rotation
                )::transform
                WHERE id = $1
            """, pawn_id, x, y, safe_z)

            logger.info(
                "Teleported account %d to (%.1f, %.1f, %.1f) [requested Z=%.1f, safe Z=%.1f]",
                account_id, x, y, safe_z, z, safe_z,
            )
            return {
                "success": True,
                "character_id": character_id,
                "position": {"x": x, "y": y, "z": safe_z},
                "requested_z": z,
                "note": (
                    "Log out FIRST, wait ~30s for the logout grace period to flush, "
                    "then log back in. The server overwrites actor transforms live while "
                    "online, so teleporting only applies on a fresh login from a fully "
                    "logged-out state."
                ),
            }

    @staticmethod
    async def _compute_safe_z(
        connection: Any,
        exclude_actor_id: int,
        target_x: float,
        target_y: float,
        requested_z: float,
        z_buffer: float = 500.0,
    ) -> float:
        """Return a Z value guaranteed to be above terrain at (target_x, target_y).

        Strategy: query all actors with transforms, find the nearest one by 2D
        distance, and use max(its Z + buffer, requested_z).  If no reference
        actors exist, return max(requested_z, 3000) as a generous fallback.
        """
        import re

        rows = await connection.fetch("""
            SELECT id, transform::text AS t
            FROM dune.actors
            WHERE transform IS NOT NULL
              AND id != $1
        """, exclude_actor_id)

        best_dist_sq: float | None = None
        best_z: float = 0.0

        for row in rows:
            nums = re.findall(r'-?[\d.]+(?:e[+-]?\d+)?', row["t"])
            if len(nums) < 3:
                continue
            ax, ay, az = float(nums[0]), float(nums[1]), float(nums[2])
            dist_sq = (ax - target_x) ** 2 + (ay - target_y) ** 2
            if best_dist_sq is None or dist_sq < best_dist_sq:
                best_dist_sq = dist_sq
                best_z = az

        if best_dist_sq is not None:
            safe = best_z + z_buffer
            logger.debug(
                "Safe Z: nearest actor Z=%.1f, buffer=%d, safe=%.1f (requested=%.1f)",
                best_z, z_buffer, safe, requested_z,
            )
            return max(safe, requested_z)

        # No reference actors at all -- use generous fallback
        return max(requested_z, 3000.0)

    # Known item template IDs derived from in-game recipes and the live
    # `dune.items` table on this server.
    # Values are (category, human-readable display name).
    KNOWN_TEMPLATES: dict[str, tuple[str, str]] = {
        # Weapons - Melee (real Unreal ids, Mk0=Artisan/
        # Mk1=Adept/Mk2=House/Mk3=Regis tier system)
        "ScrapMetalKnife": ("Weapons", "Scrap Metal Knife"),
        "Kindjal": ("Weapons", "Kindjal (Tier 0)"),
        "Kindjal_1": ("Weapons", "Artisan Kindjal"),
        "Kindjal_2": ("Weapons", "House Kindjal"),
        "Kindjal_3": ("Weapons", "Adept Kindjal"),
        "Dirk": ("Weapons", "Artisan Dirk"),
        "Dirk_0": ("Weapons", "House Dirk"),
        "Dirk_1": ("Weapons", "Adept Dirk"),
        "Dirk_3": ("Weapons", "Regis Dirk"),
        "Rapier": ("Weapons", "House Rapier"),
        "Rapier_0": ("Weapons", "Adept Rapier"),
        "Rapier_3": ("Weapons", "Regis Rapier"),
        "CHOAMSword_0": ("Weapons", "Artisan Sword (CHOAM)"),
        "CHOAMSword_2": ("Weapons", "Adept Sword (CHOAM)"),
        "UniqueSword_05": ("Weapons", "Replica Pulse-Sword Mk5"),
        "UniqueSword_04": ("Weapons", "Unique Sword Mk4"),
        # Weapons - Ranged
        "ChoamSda1": ("Weapons", "CHOAM Sidearm Mk1 (Pistol)"),
        "ChoamSda4": ("Weapons", "Artisan Maula Pistol"),
        "ChoamSda6": ("Weapons", "Adept Maula Pistol"),
        "UniqueSda_Doubleshot_04": ("Weapons", "Unique Double-Shot Sidearm"),
        "UniqueAr2": ("Weapons", "Unique Assault Rifle Mk2"),
        # Ammo - real Unreal ids
        "Ammo": ("Ammo", "Light Darts"),
        "HeavyAmmo": ("Ammo", "Heavy Darts"),
        "InfantryRocketAmmo": ("Ammo", "Missile"),
        "RocketAmmo": ("Ammo", "Rocket"),
        "Napalm": ("Ammo", "Incendiary Gel"),
        "SurveyProbeLauncher": ("Weapons", "Survey Probe Launcher"),
        # Tools
        "MiningTool_1h_Standard": ("Tools", "Cutteray Mk1 (Mining Tool)"),
        "miningtool_2h_light": ("Tools", "Cutteray Mk5 (2-Handed)"),
        "Binoculars_1": ("Tools", "Binoculars"),
        "BasicBuildingTool": ("Tools", "Building Tool"),
        # NOTE: T1_Tool_Binoculars was a recipe-prefix ghost id; removed so the
        # grant_item resolver can strip the prefix and resolve to Binoculars_1.
        "BodyFluidExtractor": ("Tools", "Improvised Blood Extractor"),
        "BodyFluidExtractor_02": ("Tools", "Blood Extractor Mk2"),
        "BodyFluidExtractor_03": ("Tools", "Blood Extractor Mk4"),
        "BodyFluidExtractor_2h_tier6": ("Tools", "Blood Extractor Mk6"),
        "PowerPack": ("Tools", "Improvised Power Pack"),
        "PowerPack5": ("Tools", "Power Pack Mk1"),
        "PowerPack2": ("Tools", "Power Pack Mk2"),
        "PowerPack6": ("Tools", "Power Pack Mk3"),
        "PowerPack3": ("Tools", "Power Pack Mk4"),
        "PowerPack7": ("Tools", "Power Pack Mk5"),
        "PowerPack4": ("Tools", "Power Pack Mk6"),
        # NOTE: T2_MiscEquipment_PowerPack was a recipe-prefix ghost; removed.
        "RepairTool": ("Tools", "Welding Torch Mk1"),
        "repairtool3": ("Tools", "Welding Torch Mk3"),
        "repairtool5": ("Tools", "Welding Torch Mk5"),
        "WeldingMaterial": ("Tools", "Welding Wire"),
        "weldingmaterial": ("Tools", "Welding Wire"),
        "PowerUnitVeryLight": ("Tools", "Very Light Power Unit"),
        "vehiclebackuptool": ("Tools", "Vehicle Backup Tool"),
        "holtzmanshieldactivedrain3": ("Tools", "Holtzman Shield Mk5"),
        "fullsuspensorbelt": ("Tools", "Suspensor Belt"),
        "decajon": ("Tools", "Decaliterjon (Canteen)"),
        "FuelCanister": ("Fuel", "Small Vehicle Fuel Cell"),
        "FuelCanister_Medium": ("Fuel", "Medium Vehicle Fuel Cell"),
        "FuelCanister_Large": ("Fuel", "Large Vehicle Fuel Cell"),
        "SpicedFuelCell": ("Fuel", "Spice-infused Fuel Cell"),
        # Resources - Raw
        "ScrapMetal": ("Resources", "Salvaged Metal"),
        "Stone": ("Resources", "Stone"),
        "PlantFiber": ("Resources", "Plant Fiber"),
        "Oil": ("Resources", "Oil"),
        "WindTurbineLubricant1": ("Resources", "Low-grade Lubricant"),
        "WindTurbineLubricant2": ("Resources", "Industrial-grade Lubricant"),
        "WindTrapFilter1": ("Resources", "Makeshift Filter"),
        "WindTrapFilter2": ("Resources", "Standard Filter"),
        "WindTrapFilter3": ("Resources", "Particulate Filter"),
        "WindTrapFilter4": ("Resources", "Advanced Particulate Filter"),
        "AzuriteOre": ("Resources", "Azurite Ore"),
        "BauxiteOre": ("Resources", "Aluminum Ore"),
        "IronBar": ("Resources", "Iron Bar"),
        "AluminiumBar": ("Resources", "Aluminum Ingot"),
        "DuraluminumRod": ("Resources", "Duraluminum Ingot"),
        "CopperBar": ("Resources", "Copper Bar"),
        "Silicone": ("Resources", "Silicon"),
        "SteelBar": ("Resources", "Steel Ingot"),
        "CobaltBar": ("Resources", "Cobalt Paste"),
        "ErythriteCrystal": ("Resources", "Erythrite Crystal"),
        "DiamondineDust": ("Resources", "Diamondine Dust"),  # legacy ghost; real: T4MysaTarilComponent1
        "T4MysaTarilComponent1": ("Resources", "Diamondine Dust"),
        "JasmiumCrystal": ("Resources", "Jasmium Crystal"),
        "CarbideScraps": ("Resources", "Carbide Scraps"),  # legacy ghost; real: T4MysaTarilComponent2
        "T4MysaTarilComponent2": ("Resources", "Carbide Scraps"),
        "IrradiatedSlag": ("Resources", "Irradiated Slag"),  # legacy ghost; real: T5RadiatedCoreComponent
        "T5RadiatedCoreComponent": ("Resources", "Irradiated Slag"),
        "FlourSand": ("Resources", "Flour Sand (spice-bearing sand)"),
        "SpiceResidue": ("Resources", "Spice Residue"),
        "Mouse_Corpse": ("Resources", "Mouse Corpse"),
        # Resources - Components
        # Keys are the REAL Unreal item template ids verified against the
        # live `dune.items` catalog (979 items). The previous
        # "friendly" key names (e.g. CalibratedServok, GunParts, ParticleCapacitor)
        # were ghost templates that rendered visually in inventory but were NOT
        # recognized for crafting. Granting under those names produced silent
        # ghost stacks - the silicon-style bug. Always grant under the real id.
        "T1UniqueComponent": ("Components", "Spice-infused Copper Dust"),
        "T2UniqueComponent": ("Components", "Spice-infused Iron Dust"),
        "T3UniqueComponent": ("Components", "Spice-infused Steel Dust"),
        "T4UniqueComponent": ("Components", "Spice-infused Aluminum Dust"),
        "T5UniqueComponent": ("Components", "Spice-infused Duraluminum Dust"),
        "T6UniqueComponent": ("Components", "Spice-infused Plastanium Dust"),
        "T1ExplorationComponent": ("Components", "Holtzman Actuator"),
        "T2HeavyComponent": ("Components", "Armor Plating"),
        "FremenComponent1": ("Components", "EMF Generator"),
        "FremenComponent2": ("Components", "Micro-Sandwich Fabric"),
        "GreatHouseComponent1": ("Components", "Plasteel Microflora Fiber"),
        "GreatHouseComponent2": ("Components", "Mechanical Parts"),
        "D_GreatHouseComponent12": ("Components", "Advanced Mechanical Parts"),
        "T1RusherComponent": ("Components", "Blade Parts"),
        "T1AssaultComponent": ("Components", "Gun Parts"),
        "T2MachineComponent": ("Components", "Complex Machinery"),
        "T6Machinery": ("Components", "Advanced Machinery"),
        "T3MiningGalleryComponent1": ("Components", "Calibrated Servok"),
        "T3MiningGalleryComponent2": ("Components", "Ray Amplifier"),
        "T3MarksmanComponent": ("Components", "Range Finder"),
        "T4HarkSpiceSiloComponent1": ("Components", "Industrial Pump"),
        "T4HarkSpiceSiloComponent2": ("Components", "Heavy Caliber Compressor"),
        "T4HarkSpiceSiloComponent3": ("Components", "Light Caliber Compressor"),
        "T4PyonVillageComponent": ("Components", "Insulated Fabric"),
        "T4MaasKharetComponent1": ("Components", "Sandtrout Leathers (resource)"),
        "T4MaasKharetComponent2": ("Components", "Stillsuit Tubing"),
        "T5FactionBaseComponent1": ("Components", "Military Power Regulator"),
        "T5FactionBaseComponent2": ("Components", "Hydraulic Piston"),
        "T6BalisticWeave": ("Components", "Ballistic Weave Fabric"),
        "T6FilteredFabric": ("Components", "Atmospheric Filtered Fabric"),
        "T6HeavyCalliberCompressor": ("Components", "Fluted Heavy Caliber Compressor"),
        "T6LightCalliberCompressor": ("Components", "Fluted Light Caliber Compressor"),
        "T6HoltzmanActuator": ("Components", "Improved Holtzman Actuator"),
        "T6Watertube": ("Components", "Improved Watertube"),
        "T6IrradiatedCore": ("Components", "Irradiated Core"),
        "T6CarbidePladeParts": ("Components", "Carbide Blade Parts"),
        "T6PlasteelComponent": ("Components", "Plasteel Plate"),
        "OldImperialComponent1": ("Components", "Advanced Servoks"),
        "OldImperialComponent2": ("Components", "Particle Capacitor"),
        "D_OldImperialComponent9": ("Components", "Optimized Servoks"),
        # Consumables - real Unreal ids cross-checked against live `dune.items`
        # inventory rows. The source data uses
        # PascalCase (HealthPack_Channeled) but on this server the lowercase
        # variant (healthpack_channeled) is the real id with non-zero instance
        # count. Always verify with `SELECT count(*) FROM dune.items WHERE
        # template_id=...` before adding new entries.
        "healthpack_channeled": ("Consumables", "Healkit (Standard)"),
        "HealthPack_Channeled": ("Consumables", "Healkit (Mk1, wiki spelling)"),
        "HealthPack_Channeled_2": ("Consumables", "Healkit Mk2 (wiki, unverified)"),
        "HealthPack_Channeled_3": ("Consumables", "Healkit Mk4 (wiki, unverified)"),
        "HealthPack_Channeled_4": ("Consumables", "Healkit Mk6 (wiki, unverified)"),
        "Bloodsack_01": ("Consumables", "Small Blood Sack"),
        "Bloodsack_02": ("Consumables", "Medium Blood Sack"),
        "Bloodsack_03": ("Consumables", "Large Blood Sack"),
        "Bloodsack_T6": ("Consumables", "Massive Blood Sack"),
        "Literjon": ("Consumables", "Literjon"),
        "Literjon_T6": ("Consumables", "Literjon Mk6"),
        "Decajon": ("Consumables", "Decaliterjon"),
        "AntiRadiationPill": ("Consumables", "Iodine Pill"),
        "SaphoJuice": ("Consumables", "Sapho Juice"),
        "SolarisCoin": ("Currency", "Solari Coins"),
        # Contracts
        "ContractItem": ("Contracts", "Contract"),
        "ContractScavengers1AutomatedPoisonSniffer": ("Contracts", "Scavenger Contract: Automated Poison Sniffer"),
        # Armor - CHOAM Light Mk6 (Tier 6)
        "combat_choam_light06_helmet": ("Armor", "CHOAM Light Helmet Mk6"),
        "combat_choam_light06_top": ("Armor", "CHOAM Light Chest Mk6"),
        "combat_choam_light06_bottom": ("Armor", "CHOAM Light Legs Mk6"),
        "combat_choam_light06_gloves": ("Armor", "CHOAM Light Gloves Mk6"),
        "combat_choam_light06_boots": ("Armor", "CHOAM Light Boots Mk6"),
        # Armor - Sandtrout Leathers
        "Combat_Nati_SandtroutLeathers01_Helmet": ("Armor", "Sandtrout Leathers Helmet"),
        "Combat_Nati_SandtroutLeathers01_Top": ("Armor", "Sandtrout Leathers Top"),
        "Combat_Nati_SandtroutLeathers01_Bottom": ("Armor", "Sandtrout Leathers Bottom"),
        "Combat_Nati_SandtroutLeathers01_Gloves": ("Armor", "Sandtrout Leathers Gloves"),
        "Combat_Nati_SandtroutLeathers01_Boots": ("Armor", "Sandtrout Leathers Boots"),
        # Armor - Bandit Leathers (recipe-prefix removed; see grant_item resolver)
        # Armor - Scavenger Rags (real Unreal ids)
        "Combat_Nati_ScavengerRags02_Helmet": ("Armor", "Scavenger Hood"),
        "Combat_Nati_ScavengerRags02_Top": ("Armor", "Scavenger Chestpiece"),
        "Combat_Nati_ScavengerRags02_Bottom": ("Armor", "Scavenger Pants"),
        "Combat_Nati_ScavengerRags02_Gloves": ("Armor", "Scavenger Gloves"),
        "Combat_Nati_ScavengerRags02_Boots": ("Armor", "Scavenger Boots"),
        # Armor - Stillsuits
        "Stillsuit_Neut_Leaking01_Gloves": ("Armor", "Leaking Stillsuit Gloves"),
        "Stillsuit_Neut_Leaking01_Mask": ("Armor", "Leaking Stillsuit Mask"),
        "Stillsuit_Neut_Leaking01_Top": ("Armor", "Leaking Stillsuit Top"),
        "stillsuit_unique_efficient_05_mask": ("Armor", "Batigh Stillsuit Mask (T5 Unique)"),
        "stillsuit_unique_efficient_05_top": ("Armor", "Batigh Stillsuit Top (T5 Unique)"),
        "stillsuit_unique_efficient_05_gloves": ("Armor", "Batigh Stillsuit Gloves (T5 Unique)"),
        "stillsuit_unique_efficient_05_boots": ("Armor", "Batigh Stillsuit Boots (T5 Unique)"),
        "Stillsuit_Unique_Efficient_04_mask": ("Armor", "Efficient Stillsuit Mask (T4 Unique)"),
        "Stillsuit_Unique_Efficient_04_top": ("Armor", "Efficient Stillsuit Top (T4 Unique)"),
        "Stillsuit_Unique_Efficient_04_gloves": ("Armor", "Efficient Stillsuit Gloves (T4 Unique)"),
        "Stillsuit_Unique_Efficient_04_boots": ("Armor", "Efficient Stillsuit Boots (T4 Unique)"),
        "Stillsuit_Unique_Armored_01_Gloves_Schematic": ("Schematics", "Armored Stillsuit Gloves Schematic"),
        # Social / Cosmetics
        "Social_Choam_MaulaCastOffs01_Bottom": ("Cosmetics", "Maula Cast-Offs Bottom"),
        "Social_Choam_MaulaCastOffs01_Gloves": ("Cosmetics", "Maula Cast-Offs Gloves"),
        "Social_Choam_MaulaCastOffs01_Shoes": ("Cosmetics", "Maula Cast-Offs Shoes"),
        "Social_Choam_MaulaCastOffs01_Top_Fremkit": ("Cosmetics", "Maula Cast-Offs Top (Fremkit)"),
        # Vehicle Parts (PascalCase - real Unreal ids)
        # Sandbike Mk6 (top tier)
        "SandbikeChassis_6": ("Vehicle Parts", "Sandbike Chassis Mk6"),
        "SandbikeEngine_6": ("Vehicle Parts", "Sandbike Engine Mk6"),
        "SandbikeHull_6": ("Vehicle Parts", "Sandbike Hull Mk6"),
        "SandbikeLocomotion_6": ("Vehicle Parts", "Sandbike Tread Mk6"),
        "SandbikeGenerator_6": ("Vehicle Parts", "Sandbike PSU Mk6"),
        "SandbikeBoost_6": ("Vehicle Parts", "Sandbike Booster Mk6"),
        "SandbikeInventory_2": ("Vehicle Parts", "Sandbike Inventory Mk2"),
        "SandbikeSeat_1": ("Vehicle Parts", "Sandbike Backseat Mk1"),
        "SandbikeScanner_2": ("Vehicle Parts", "Sandbike Scanner Mk2"),
        # Buggy Mk6
        "BuggyChassis_6": ("Vehicle Parts", "Buggy Chassis Mk6"),
        "BuggyEngine_6": ("Vehicle Parts", "Buggy Engine Mk6"),
        "BuggyHullFront_6": ("Vehicle Parts", "Buggy Hull Mk6"),
        "BuggyHullBack_6": ("Vehicle Parts", "Buggy Rear Mk6"),
        "BuggyHullBackExtra_6": ("Vehicle Parts", "Buggy Utility Rear Mk6"),
        "BuggyGenerator_6": ("Vehicle Parts", "Buggy PSU Mk6"),
        "BuggyLocomotion_6": ("Vehicle Parts", "Buggy Tread Mk6"),
        "BuggyBoost_6": ("Vehicle Parts", "Buggy Booster Mk6"),
        "BuggyInventory_6": ("Vehicle Parts", "Buggy Storage Mk6"),
        "BuggyMining_6": ("Vehicle Parts", "Buggy Cutteray Mk6"),
        "BuggyLauncher_6": ("Vehicle Parts", "Buggy Rocket Launcher Mk6"),
        # Sandcrawler Mk6 (only tier for sandcrawler)
        "SandcrawlerChassis_6": ("Vehicle Parts", "Sandcrawler Chassis Mk6"),
        "SandcrawlerEngine_6": ("Vehicle Parts", "Sandcrawler Engine Mk6"),
        "SandcrawlerHull_6": ("Vehicle Parts", "Sandcrawler Cabin Mk6"),
        "SandcrawlerGenerator_6": ("Vehicle Parts", "Sandcrawler PSU Mk6"),
        "SandcrawlerLocomotion_6": ("Vehicle Parts", "Sandcrawler Tread Mk6"),
        "SandcrawlerSpiceContainer_6": ("Vehicle Parts", "Sandcrawler Centrifuge Mk6"),
        "SandcrawlerSpiceHeader_6": ("Vehicle Parts", "Sandcrawler Vacuum Mk6"),
        # Scout Ornithopter Mk6 (PascalCase - the lowercase entries below this
        # block were ghosts; left in temporarily for back-compat with any DB rows)
        "OrnithopterLightChassis_6": ("Vehicle Parts", "Scout Ornithopter Chassis Mk6"),
        "OrnithopterLightEngine_6": ("Vehicle Parts", "Scout Ornithopter Engine Mk6"),
        "OrnithopterLightHullFront_6": ("Vehicle Parts", "Scout Ornithopter Cockpit Mk6"),
        "OrnithopterLightHullBack_6": ("Vehicle Parts", "Scout Ornithopter Hull Mk6"),
        "OrnithopterLightGenerator_6": ("Vehicle Parts", "Scout Ornithopter Generator Mk6"),
        "OrnithopterLightBoost_6": ("Vehicle Parts", "Scout Ornithopter Thruster Mk6"),
        "OrnithopterLightLauncher_6": ("Vehicle Parts", "Scout Ornithopter Rocket Launcher Mk6"),
        "OrnithopterLightLocomotion_6": ("Vehicle Parts", "Scout Ornithopter Wing Mk6"),
        "OrnithopterLightLocomotion_Unique_Speed_6": ("Vehicle Parts", "Albatross Wing Module Mk6"),
        "OrnithopterLightInventory_4": ("Vehicle Parts", "Scout Ornithopter Storage Mk4"),
        "OrnithopterLightScanner_4": ("Vehicle Parts", "Scout Ornithopter Scan Module"),
        # Assault Ornithopter Mk6
        "OrnithopterMediumChassis_6": ("Vehicle Parts", "Assault Ornithopter Chassis Mk6"),
        "OrnithopterMediumEngine_6": ("Vehicle Parts", "Assault Ornithopter Engine Mk6"),
        "OrnithopterMediumHull_6": ("Vehicle Parts", "Assault Ornithopter Cabin Mk6"),
        "OrnithopterMediumHullFront_6": ("Vehicle Parts", "Assault Ornithopter Cockpit Mk6"),
        "OrnithopterMediumHullBack_6": ("Vehicle Parts", "Assault Ornithopter Tail Mk6"),
        "OrnithopterMediumLocomotion_6": ("Vehicle Parts", "Assault Ornithopter Wing Mk6"),
        "OrnithopterMediumGenerator_6": ("Vehicle Parts", "Assault Ornithopter Generator Mk6"),
        "OrnithopterMediumBoost_6": ("Vehicle Parts", "Assault Ornithopter Thruster Mk6"),
        "OrnithopterMediumLauncher_6": ("Vehicle Parts", "Assault Ornithopter Rocket Launcher Mk6"),
        "OrnithopterMediumLocomotion_Unique_Strafe_6": ("Vehicle Parts", "Hummingbird Wing Module Mk6"),
        "OrnithopterMediumInventory_5": ("Vehicle Parts", "Assault Ornithopter Storage Mk5"),
        # Legacy sandbike Mk1 entries (real, lower tier — kept since they're
        # in older inventories)
        "SandbikeEngine_1": ("Vehicle Parts", "Sandbike Engine Mk1"),
        "SandbikeLocomotion_1": ("Vehicle Parts", "Sandbike Tread Mk1"),
        # Schematics (only confirmed-real entries; ghost names removed)
        "SandbikeEngine_Unique_Speed_1_Schematic": ("Schematics", "Unique Speed Sandbike Engine Schematic"),
        # Structures
        "RespawnBeacon": ("Structures", "Respawn Beacon"),
        # Emotes
        "Emote_Bow_01": ("Emotes", "Bow"),
        "Emote_Clap_01": ("Emotes", "Clap"),
        "Emote_Follow_01": ("Emotes", "Follow Me"),
        "Emote_No_01": ("Emotes", "No"),
        "Emote_Point_01": ("Emotes", "Point"),
        "Emote_Sit_01": ("Emotes", "Sit"),
        "Emote_Threaten_01": ("Emotes", "Threaten"),
        "Emote_Yes_01": ("Emotes", "Yes"),
        "Emote_ShakeOffSand_01": ("Emotes", "Shake Off Sand"),
        "Emote_AtreSalute_01": ("Emotes", "Atreides Salute"),
        "Emote_AdjustStillsuit": ("Emotes", "Adjust Stillsuit"),
        "Emote_KaitanBow_01": ("Emotes", "Kaitan Bow"),

        # ----- 1979201 (June 2026) build additions ------------------------
        # CHOAM faction gear (new with the June '26 patch)
        "CHOAMSword":               ("Weapons", "Standard Sword (CHOAM)"),
        "ChoamSda3":                ("Weapons", "Standard Maula Pistol (CHOAM)"),
        "ChoamCom1":                ("Weapons", "Static Compactor (CHOAM)"),
        "Combat_Choam_Heavy02_Boots":   ("Apparel", "Kirab Heavy Boots"),
        "Combat_Choam_Heavy02_Bottom":  ("Apparel", "Kirab Heavy Pants"),
        "Combat_Choam_Heavy02_Gloves":  ("Apparel", "Kirab Heavy Gauntlet"),
        "Combat_Choam_Heavy02_Helmet":  ("Apparel", "Kirab Heavy Headwrap"),
        "Combat_Choam_Heavy02_Top":     ("Apparel", "Kirab Heavy Jerkin"),
        "Combat_Choam_Light02_Gloves":  ("Apparel", "Kirab Scout Gloves"),
        "Combat_Choam_Light02_Top":     ("Apparel", "Kirab Scout Jacket"),
        "Combat_Choam_Light03_Boots":   ("Apparel", "Slaver Scout Boots"),
        "Stillsuit_Choam_02_Boots":     ("Apparel", "Kirab Stillsuit Boots"),
        "Stillsuit_Choam_02_Gloves":    ("Apparel", "Kirab Stillsuit Gloves"),
        "Stillsuit_Choam_02_Mask":      ("Apparel", "Kirab Stillsuit Mask"),
        "Stillsuit_Choam_02_Top":       ("Apparel", "Kirab Stillsuit Body"),
        "Stillsuit_Choam_04_Boots":     ("Apparel", "Native Stillsuit Boots"),
        "Stillsuit_Choam_04_Gloves":    ("Apparel", "Native Stillsuit Gloves"),
        "Stillsuit_Choam_04_Mask":      ("Apparel", "Native Stillsuit Mask"),
        "Stillsuit_Choam_04_Top":       ("Apparel", "Native Stillsuit Body"),

        # Quality-of-life utilities the dashboard didn't expose before
        "BuildingBlueprint_CopyDevice": ("Utilities", "Solido Replicator (blueprint copier)"),
        "Scanner_Base_1":               ("Utilities", "Handheld Resource Scanner"),
        "HighCapacityLiterjon":         ("Utilities", "Hajra Literjon Mk1 (high-capacity water)"),
        "SuspensorBelt":                ("Utilities", "Leap Suspensor Belt"),
        "PartialStabilizationBelt":     ("Utilities", "Planar Suspensor Belt"),
        "HandHeldTorch":                ("Utilities", "Glowtube"),
        "HoltzmanShieldActiveDrain":    ("Utilities", "Holtzman Shield Mk2"),
        "HoltzmanShieldActiveDrain2":   ("Utilities", "Holtzman Shield Mk3"),

        # Resources newly observed in live items
        "WormTooth":     ("Resources", "Worm Tooth"),
        "MelangeSpice": ("Resources", "Spice Melange"),
        "T6RefinedResourceA": ("Resources", "Plastanium Ingot"),
        "T6GunPart": ("Components", "Plasteel Composite Gun Parts"),
        "T6BladePart": ("Components", "Plasteel Composite Blade Parts"),
        "T5DeepDesertShieldWallComponent": ("Components", "Thermoelectric Cooler"),
        "Basalt":        ("Resources", "Basalt Stone"),
        "DolomiteRock":  ("Resources", "Carbon Ore (Dolomite)"),
        "MagnetiteOre":  ("Resources", "Iron Ore (Magnetite)"),

        # Unique / legendary weapons
        "DewReaper_Scythe":          ("Weapons", "Dew Scythe Mk4 (legendary)"),
        "DewReaper_prototype":       ("Weapons", "Dew Reaper Mk2"),
        "MiningTool_1h_Unique_01":   ("Tools",   "Sim's Cutter (unique)"),
        "MiningTool_1h_Light":       ("Tools",   "Cutteray Mk2"),
        "UniqueSword":               ("Weapons", "Pseudo Pulse-Sword"),
        "UniqueSda_Story_Ari":       ("Weapons", "Ari's Pistol (story unique)"),

        # House faction firearms (new ladders)
        "AtreSmg2":               ("Weapons", "Standard Disruptor M11 (Atreides)"),
        "HarkAr2":                ("Weapons", "Karpov 38 (Harkonnen)"),
        "HarkAr4":                ("Weapons", "Artisan Karpov 38 (Harkonnen)"),
        "HarkAr5":                ("Weapons", "House Karpov 38 (Harkonnen)"),
        "SmugDmr3":               ("Weapons", "Artisan JABAL Spitdart"),
        "Scattergun_Prototype":   ("Weapons", "Standard GRDA 44"),
        "Scattergun_Prototype0":  ("Weapons", "Artisan GRDA 44"),

        # Vehicle parts: existing-ladder middle tiers
        "BuggyBoost_3":      ("Vehicles", "Buggy Booster Mk3"),
        "BuggyGenerator_3":  ("Vehicles", "Buggy PSU Mk3"),
        "BuggyInventory_3":  ("Vehicles", "Buggy Storage Mk3"),
        "SandbikeBoost_2":   ("Vehicles", "Sandbike Booster Mk2"),
        "SandbikeEngine_3":  ("Vehicles", "Sandbike Engine Mk3"),
        "SandbikeGenerator_1": ("Vehicles", "Sandbike PSU Mk1"),
        "SandbikeGenerator_3": ("Vehicles", "Sandbike PSU Mk3"),
        "SandbikeHull_1":    ("Vehicles", "Sandbike Hull Mk1"),

        # Spice consumables
        "SpiceAddictionConsumable_01": ("Consumables", "Melange Spiced Food"),
        "SpiceAddictionConsumable_02": ("Consumables", "Melange Spiced Beer"),

        # ----- Bulk vehicle catalog audit (Mk0-Mk5 ladders + uniques + Carrier Ornithopter) -----
        # Covers every Buggy/
        # Sandbike/Sandcrawler/Ornithopter template that
        # wasn't already in our catalog. Adds 135 entries so they're grant-able
        # by template ID via search/manual input. Most-used mid-tiers also have
        # dashboard buttons; the rest are reachable via the Item Template
        # Search panel.
        # Buggy ladder & uniques
        "BuggyChassis_0":   ("Vehicles", "Scrap Buggy Chassis"),
        "BuggyChassis_3":   ("Vehicles", "Buggy Chassis Mk3"),
        "BuggyChassis_4":   ("Vehicles", "Buggy Chassis Mk4"),
        "BuggyChassis_5":   ("Vehicles", "Buggy Chassis Mk5"),
        "BuggyEngine_0":    ("Vehicles", "Scrap Buggy Engine"),
        "BuggyEngine_3":    ("Vehicles", "Buggy Engine Mk3"),
        "BuggyEngine_4":    ("Vehicles", "Buggy Engine Mk4"),
        "BuggyEngine_5":    ("Vehicles", "Buggy Engine Mk5"),
        "BuggyEngine_Unique_Accelerate_03": ("Vehicles Unique", "Bluddshot Buggy Engine Mk3"),
        "BuggyEngine_Unique_Accelerate_04": ("Vehicles Unique", "Bluddshot Buggy Engine Mk4"),
        "BuggyEngine_Unique_Accelerate_05": ("Vehicles Unique", "Bluddshot Buggy Engine Mk5"),
        "BuggyEngine_Unique_Accelerate_06": ("Vehicles Unique", "Bluddshot Buggy Engine Mk6"),
        "BuggyGenerator_0": ("Vehicles", "Scrap Buggy PSU"),
        "BuggyGenerator_4": ("Vehicles", "Buggy PSU Mk4"),
        "BuggyGenerator_5": ("Vehicles", "Buggy PSU Mk5"),
        "BuggyHullBack_0":  ("Vehicles", "Scrap Buggy Rear Hull"),
        "BuggyHullBack_3":  ("Vehicles", "Buggy Rear Mk3"),
        "BuggyHullBack_4":  ("Vehicles", "Buggy Rear Mk4"),
        "BuggyHullBack_5":  ("Vehicles", "Buggy Rear Mk5"),
        "BuggyHullBackExtra_3": ("Vehicles", "Buggy Utility Rear Mk3"),
        "BuggyHullBackExtra_4": ("Vehicles", "Buggy Utility Rear Mk4"),
        "BuggyHullBackExtra_5": ("Vehicles", "Buggy Utility Rear Mk5"),
        "BuggyHullFront_0": ("Vehicles", "Scrap Buggy Front Hull"),
        "BuggyHullFront_3": ("Vehicles", "Buggy Hull Mk3"),
        "BuggyHullFront_4": ("Vehicles", "Buggy Hull Mk4"),
        "BuggyHullFront_5": ("Vehicles", "Buggy Hull Mk5"),
        "BuggyInventory_4": ("Vehicles", "Buggy Storage Mk4"),
        "BuggyInventory_5": ("Vehicles", "Buggy Storage Mk5"),
        "BuggyInventory_Unique_Capacity_03": ("Vehicles Unique", "Bigger Buggy Boot Mk3"),
        "BuggyInventory_Unique_Capacity_04": ("Vehicles Unique", "Bigger Buggy Boot Mk4"),
        "BuggyInventory_Unique_Capacity_05": ("Vehicles Unique", "Bigger Buggy Boot Mk5"),
        "BuggyInventory_Unique_Capacity_06": ("Vehicles Unique", "Bigger Buggy Boot Mk6"),
        "BuggyLauncher_5":  ("Vehicles", "Buggy Rocket Launcher Mk5"),
        "BuggyLocomotion_0": ("Vehicles", "Scrap Buggy Tread"),
        "BuggyLocomotion_3": ("Vehicles", "Buggy Tread Mk3"),
        "BuggyLocomotion_4": ("Vehicles", "Buggy Tread Mk4"),
        "BuggyLocomotion_5": ("Vehicles", "Buggy Tread Mk5"),
        "BuggyMining_3":    ("Vehicles", "Buggy Cutteray Mk3"),
        "BuggyMining_4":    ("Vehicles", "Buggy Cutteray Mk4"),
        "BuggyMining_5":    ("Vehicles", "Buggy Cutteray Mk5"),
        "BuggyMining_Unique_YieldIncrease_03": ("Vehicles Unique", "Focused Buggy Cutteray Mk3"),
        "BuggyMining_Unique_YieldIncrease_04": ("Vehicles Unique", "Focused Buggy Cutteray Mk4"),
        "BuggyMining_Unique_YieldIncrease_05": ("Vehicles Unique", "Focused Buggy Cutteray Mk5"),
        "BuggyMining_Unique_YieldIncrease_06": ("Vehicles Unique", "Focused Buggy Cutteray Mk6"),
        "BuggyBoost_4":     ("Vehicles", "Buggy Booster Mk4"),
        "BuggyBoost_5":     ("Vehicles", "Buggy Booster Mk5"),
        "BuggyBoost_Unique_LessHeat_3": ("Vehicles Unique", "Rattler Boost Module Mk3"),
        "BuggyBoost_Unique_LessHeat_4": ("Vehicles Unique", "Rattler Boost Module Mk4"),
        "BuggyBoost_Unique_LessHeat_5": ("Vehicles Unique", "Rattler Boost Module Mk5"),
        "BuggyBoost_Unique_LessHeat_6": ("Vehicles Unique", "Rattler Boost Module Mk6"),

        # Sandbike ladder & uniques
        "SandbikeChassis_0": ("Vehicles", "Scrap Sandbike Chassis"),
        "SandbikeChassis_1": ("Vehicles", "Sandbike Chassis Mk1"),
        "SandbikeChassis_2": ("Vehicles", "Sandbike Chassis Mk2"),
        "SandbikeChassis_3": ("Vehicles", "Sandbike Chassis Mk3"),
        "SandbikeChassis_4": ("Vehicles", "Sandbike Chassis Mk4"),
        "SandbikeChassis_5": ("Vehicles", "Sandbike Chassis Mk5"),
        "SandbikeEngine_0": ("Vehicles", "Scrap Sandbike Engine"),
        "SandbikeEngine_2": ("Vehicles", "Sandbike Engine Mk2"),
        "SandbikeEngine_4": ("Vehicles", "Sandbike Engine Mk4"),
        "SandbikeEngine_5": ("Vehicles", "Sandbike Engine Mk5"),
        "SandbikeEngine_Unique_Speed_2": ("Vehicles Unique", "Mohandis Sandbike Engine Mk2"),
        "SandbikeEngine_Unique_Speed_3": ("Vehicles Unique", "Mohandis Sandbike Engine Mk3"),
        "SandbikeEngine_Unique_Speed_4": ("Vehicles Unique", "Mohandis Sandbike Engine Mk4"),
        "SandbikeEngine_Unique_Speed_5": ("Vehicles Unique", "Mohandis Sandbike Engine Mk5"),
        "SandbikeEngine_Unique_Speed_6": ("Vehicles Unique", "Mohandis Sandbike Engine Mk6"),
        "SandbikeGenerator_0": ("Vehicles", "Scrap Sandbike PSU"),
        "SandbikeGenerator_2": ("Vehicles", "Sandbike PSU Mk2"),
        "SandbikeGenerator_4": ("Vehicles", "Sandbike PSU Mk4"),
        "SandbikeGenerator_5": ("Vehicles", "Sandbike PSU Mk5"),
        "SandbikeHull_0":   ("Vehicles", "Scrap Sandbike Hull"),
        "SandbikeHull_2":   ("Vehicles", "Sandbike Hull Mk2"),
        "SandbikeHull_3":   ("Vehicles", "Sandbike Hull Mk3"),
        "SandbikeHull_4":   ("Vehicles", "Sandbike Hull Mk4"),
        "SandbikeHull_5":   ("Vehicles", "Sandbike Hull Mk5"),
        "SandbikeInventory_1": ("Vehicles", "Sandbike Inventory Mk1"),
        "SandbikeLocomotion_0": ("Vehicles", "Scrap Sandbike Tread"),
        "SandbikeLocomotion_2": ("Vehicles", "Sandbike Tread Mk2"),
        "SandbikeLocomotion_3": ("Vehicles", "Sandbike Tread Mk3"),
        "SandbikeLocomotion_4": ("Vehicles", "Sandbike Tread Mk4"),
        "SandbikeLocomotion_5": ("Vehicles", "Sandbike Tread Mk5"),
        "SandbikeBoost_3":  ("Vehicles", "Sandbike Booster Mk3"),
        "SandbikeBoost_4":  ("Vehicles", "Sandbike Booster Mk4"),
        "SandbikeBoost_5":  ("Vehicles", "Sandbike Booster Mk5"),
        "SandbikeBoost_Unique_LessHeat_2": ("Vehicles Unique", "Night Rider Sandbike Boost Mk2"),
        "SandbikeBoost_Unique_LessHeat_3": ("Vehicles Unique", "Night Rider Sandbike Boost Mk3"),
        "SandbikeBoost_Unique_LessHeat_4": ("Vehicles Unique", "Night Rider Sandbike Boost Mk4"),
        "SandbikeBoost_Unique_LessHeat_5": ("Vehicles Unique", "Night Rider Sandbike Boost Mk5"),
        "SandbikeBoost_Unique_LessHeat_6": ("Vehicles Unique", "Night Rider Sandbike Boost Mk6"),
        "SandbikeSeat_0":   ("Vehicles", "Scrap Sandbike Extra Seat"),

        # Ornithopter Light (Scout) ladder & uniques
        "OrnithopterLightBoost_4": ("Vehicles", "Scout Ornithopter Thruster Mk4"),
        "OrnithopterLightBoost_5": ("Vehicles", "Scout Ornithopter Thruster Mk5"),
        "OrnithopterLightBoost_Unique_LessHeat_4": ("Vehicles Unique", "Stormrider Boost Module Mk4"),
        "OrnithopterLightBoost_Unique_LessHeat_5": ("Vehicles Unique", "Stormrider Boost Module Mk5"),
        "OrnithopterLightBoost_Unique_LessHeat_6": ("Vehicles Unique", "Stormrider Boost Module Mk6"),
        "OrnithopterLightChassis_4": ("Vehicles", "Scout Ornithopter Chassis Mk4"),
        "OrnithopterLightChassis_5": ("Vehicles", "Scout Ornithopter Chassis Mk5"),
        "OrnithopterLightEngine_4": ("Vehicles", "Scout Ornithopter Engine Mk4"),
        "OrnithopterLightEngine_5": ("Vehicles", "Scout Ornithopter Engine Mk5"),
        "OrnithopterLightGenerator_4": ("Vehicles", "Scout Ornithopter Generator Mk4"),
        "OrnithopterLightGenerator_5": ("Vehicles", "Scout Ornithopter Generator Mk5"),
        "OrnithopterLightHullBack_4": ("Vehicles", "Scout Ornithopter Hull Mk4"),
        "OrnithopterLightHullBack_5": ("Vehicles", "Scout Ornithopter Hull Mk5"),
        "OrnithopterLightHullFront_4": ("Vehicles", "Scout Ornithopter Cockpit Mk4"),
        "OrnithopterLightHullFront_5": ("Vehicles", "Scout Ornithopter Cockpit Mk5"),
        "OrnithopterLightLauncher_5": ("Vehicles", "Scout Ornithopter Rocket Launcher Mk5"),
        "OrnithopterLightLocomotion_4": ("Vehicles", "Scout Ornithopter Wing Mk4"),
        "OrnithopterLightLocomotion_5": ("Vehicles", "Scout Ornithopter Wing Mk5"),
        "OrnithopterLightLocomotion_Unique_Speed_4": ("Vehicles Unique", "Albatross Wing Module Mk4"),
        "OrnithopterLightLocomotion_Unique_Speed_5": ("Vehicles Unique", "Albatross Wing Module Mk5"),

        # Ornithopter Medium (Assault) ladder & uniques
        "OrnithopterMediumBoost_5": ("Vehicles", "Assault Ornithopter Thruster Mk5"),
        "OrnithopterMediumBoost_Unique_LessHeat_5": ("Vehicles Unique", "Steady Assault Boost Module Mk5"),
        "OrnithopterMediumBoost_Unique_LessHeat_6": ("Vehicles Unique", "Steady Assault Boost Module Mk6"),
        "OrnithopterMediumChassis_5": ("Vehicles", "Assault Ornithopter Chassis Mk5"),
        "OrnithopterMediumEngine_5":  ("Vehicles", "Assault Ornithopter Engine Mk5"),
        "OrnithopterMediumGenerator_5": ("Vehicles", "Assault Ornithopter Generator Mk5"),
        "OrnithopterMediumHull_5":    ("Vehicles", "Assault Ornithopter Cabin Mk5"),
        "OrnithopterMediumHullBack_5": ("Vehicles", "Assault Ornithopter Tail Mk5"),
        "OrnithopterMediumHullFront_5": ("Vehicles", "Assault Ornithopter Cockpit Mk5"),
        "OrnithopterMediumLauncher_5": ("Vehicles", "Assault Ornithopter Rocket Launcher Mk5"),
        "OrnithopterMediumLocomotion_5": ("Vehicles", "Assault Ornithopter Wing Mk5"),
        "OrnithopterMediumLocomotion_Unique_Strafe_5": ("Vehicles Unique", "Hummingbird Wing Module Mk5"),

        # Ornithopter Transport (Carrier) - new vehicle class, Mk6 only
        "OrnithopterTransportBoost_6":     ("Vehicles", "Carrier Ornithopter Thruster Mk6"),
        "OrnithopterTransportBoost_Unique_LessHeat_06": ("Vehicles Unique", "Steady Carrier Boost Module Mk6"),
        "OrnithopterTransportChassis_6":   ("Vehicles", "Carrier Ornithopter Chassis Mk6"),
        "OrnithopterTransportEngine_6":    ("Vehicles", "Carrier Ornithopter Engine Mk6"),
        "OrnithopterTransportGenerator_6": ("Vehicles", "Carrier Ornithopter Generator Mk6"),
        "OrnithopterTransportHull_6":      ("Vehicles", "Carrier Ornithopter Main Hull Mk6"),
        "OrnithopterTransportHullBack_6":  ("Vehicles", "Carrier Ornithopter Tail Hull Mk6"),
        "OrnithopterTransportHullFront_6": ("Vehicles", "Carrier Ornithopter Side Hull Mk6"),
        "OrnithopterTransportLocomotion_6": ("Vehicles", "Carrier Ornithopter Wing Mk6"),
        "OrnithopterTransportLocomotion_Unique_Speed_6": ("Vehicles Unique", "Roc Carrier Wing"),

        # Sandcrawler uniques (Mk6 ladder already in catalog)
        "SandcrawlerEngine_Unique_Speed_06": ("Vehicles Unique", "Walker Sandcrawler Engine Mk6"),
        "SandcrawlerLocomotion_Unique_WormThreat_06": ("Vehicles Unique", "Dampened Sandcrawler Treads"),
        # =====================================================================
        # VERIFIED LIVE-DB ADDITIONS (cross-checked against dune.items table)
        # =====================================================================
        # Weapons — Faction Ranged
        "AtreLMG4": ("Weapons", "Atreides LMG Mk4"),
        "AtreSmg2": ("Weapons", "Atreides SMG Mk2"),
        "HarkAr2": ("Weapons", "Harkonnen Assault Rifle Mk2"),
        "HarkAr4": ("Weapons", "Harkonnen Assault Rifle Mk4"),
        "HarkAr5": ("Weapons", "Harkonnen Assault Rifle Mk5"),
        "HarkAr6": ("Weapons", "Harkonnen Assault Rifle Mk6"),
        "HarkHeavyPistol2": ("Weapons", "Harkonnen Heavy Pistol Mk2"),
        "SmugDmr3": ("Weapons", "Smuggler DMR Mk3"),
        "SmugShot4": ("Weapons", "Smuggler Shotgun Mk4"),
        "ChoamCom1": ("Weapons", "CHOAM Commando Mk1"),
        "ChoamSda3": ("Weapons", "CHOAM Sidearm Mk3"),
        "CHOAMSword": ("Weapons", "CHOAM Sword (Tier 0)"),
        "RocketLauncher_3": ("Weapons", "Rocket Launcher Mk3"),
        "Scattergun_Prototype": ("Weapons", "Scattergun Prototype"),
        "Scattergun_Prototype0": ("Weapons", "Scattergun Prototype Mk0"),
        "DewReaper_Scythe": ("Weapons", "Dew Reaper Scythe"),
        "DewReaper_prototype": ("Weapons", "Dew Reaper Prototype"),
        "UniqueAr_Burst_02": ("Weapons", "Unique Burst AR Mk2"),
        "UniqueSda2": ("Weapons", "Unique Sidearm Mk2"),
        "UniqueSda_Story_Ari": ("Weapons", "Unique Story Sidearm (Ari)"),
        "UniqueSword": ("Weapons", "Unique Sword"),
        # Shields
        "HoltzmanShieldActiveDrain": ("Shields", "Holtzman Shield Mk1"),
        "HoltzmanShieldActiveDrain2": ("Shields", "Holtzman Shield Mk2"),
        # Armor — CHOAM Heavy
        "Combat_Choam_Heavy01_Helmet": ("Armor", "CHOAM Heavy Helmet Mk1"),
        "Combat_Choam_Heavy01_Top": ("Armor", "CHOAM Heavy Chest Mk1"),
        "Combat_Choam_Heavy01_Bottom": ("Armor", "CHOAM Heavy Legs Mk1"),
        "Combat_Choam_Heavy01_Gloves": ("Armor", "CHOAM Heavy Gloves Mk1"),
        "Combat_Choam_Heavy01_Boots": ("Armor", "CHOAM Heavy Boots Mk1"),
        "Combat_Choam_Heavy02_Helmet": ("Armor", "CHOAM Heavy Helmet Mk2"),
        "Combat_Choam_Heavy02_Top": ("Armor", "CHOAM Heavy Chest Mk2"),
        "Combat_Choam_Heavy02_Bottom": ("Armor", "CHOAM Heavy Legs Mk2"),
        "Combat_Choam_Heavy02_Gloves": ("Armor", "CHOAM Heavy Gloves Mk2"),
        "Combat_Choam_Heavy02_Boots": ("Armor", "CHOAM Heavy Boots Mk2"),
        "Combat_Choam_Heavy03_Helmet": ("Armor", "CHOAM Heavy Helmet Mk3"),
        "Combat_Choam_Heavy03_Top": ("Armor", "CHOAM Heavy Chest Mk3"),
        "Combat_Choam_Heavy03_Bottom": ("Armor", "CHOAM Heavy Legs Mk3"),
        "Combat_Choam_Heavy03_Gloves": ("Armor", "CHOAM Heavy Gloves Mk3"),
        "Combat_Choam_Heavy03_Boots": ("Armor", "CHOAM Heavy Boots Mk3"),
        "Combat_Choam_Heavy04_Helmet": ("Armor", "CHOAM Heavy Helmet Mk4"),
        "Combat_Choam_Heavy04_Top": ("Armor", "CHOAM Heavy Chest Mk4"),
        "Combat_Choam_Heavy04_Bottom": ("Armor", "CHOAM Heavy Legs Mk4"),
        "Combat_Choam_Heavy04_Gloves": ("Armor", "CHOAM Heavy Gloves Mk4"),
        "Combat_Choam_Heavy04_Shoes": ("Armor", "CHOAM Heavy Shoes Mk4"),
        # Armor — CHOAM Light
        "Combat_Choam_Light02_Gloves": ("Armor", "CHOAM Light Gloves Mk2"),
        "Combat_Choam_Light02_Helmet": ("Armor", "CHOAM Light Helmet Mk2"),
        "Combat_Choam_Light02_Top": ("Armor", "CHOAM Light Chest Mk2"),
        "Combat_Choam_Light03_Boots": ("Armor", "CHOAM Light Boots Mk3"),
        "Combat_Choam_Light03_Bottom": ("Armor", "CHOAM Light Legs Mk3"),
        "Combat_Choam_Light03_Helmet": ("Armor", "CHOAM Light Helmet Mk3"),
        # Stillsuits — CHOAM
        "Stillsuit_Choam_02_Boots": ("Stillsuits", "CHOAM Stillsuit Boots Mk2"),
        "Stillsuit_Choam_02_Gloves": ("Stillsuits", "CHOAM Stillsuit Gloves Mk2"),
        "Stillsuit_Choam_02_Mask": ("Stillsuits", "CHOAM Stillsuit Mask Mk2"),
        "Stillsuit_Choam_02_Top": ("Stillsuits", "CHOAM Stillsuit Top Mk2"),
        "Stillsuit_Choam_04_Boots": ("Stillsuits", "CHOAM Stillsuit Boots Mk4"),
        "Stillsuit_Choam_04_Gloves": ("Stillsuits", "CHOAM Stillsuit Gloves Mk4"),
        "Stillsuit_Choam_04_Mask": ("Stillsuits", "CHOAM Stillsuit Mask Mk4"),
        "Stillsuit_Choam_04_Top": ("Stillsuits", "CHOAM Stillsuit Top Mk4"),
        # Stillsuits — Unique
        "Stillsuit_Unique_Efficient_05_Boots": ("Stillsuits", "Efficient Stillsuit Boots Mk5"),
        "Stillsuit_Unique_Efficient_05_Gloves": ("Stillsuits", "Efficient Stillsuit Gloves Mk5"),
        "Stillsuit_Unique_Efficient_05_Mask": ("Stillsuits", "Efficient Stillsuit Mask Mk5"),
        "Stillsuit_Unique_Efficient_05_Top": ("Stillsuits", "Efficient Stillsuit Top Mk5"),
        # Cosmetics / Social
        "Social_Smug_EntrepreneurCasual03_Boots": ("Cosmetics", "Smuggler Entrepreneur Boots"),
        "Social_Smug_EntrepreneurCasual03_Bottom": ("Cosmetics", "Smuggler Entrepreneur Pants"),
        "Social_Smug_EntrepreneurCasual03_Gloves": ("Cosmetics", "Smuggler Entrepreneur Gloves"),
        "Social_Smug_EntrepreneurCasual03_Top": ("Cosmetics", "Smuggler Entrepreneur Top"),
        # Schematics
        "Combat_Light_Unique_DewReap_Gloves_03_Schematic": ("Schematics", "Dew Reaper Light Gloves Schematic"),
        "Combat_Neut_SmugglerDeserterUnique02_Bottom_Schematic": ("Schematics", "Smuggler Deserter Pants Schematic"),
        "Schematic_UniqueBuggyBoost": ("Schematics", "Unique Buggy Booster Schematic"),
        "Schematic_UniqueMaulaPistol": ("Schematics", "Unique Maula Pistol Schematic"),
        # Tools
        "MiningTool_1h_Heavy": ("Tools", "Cutteray Mk3 (Heavy 1H)"),
        "MiningTool_1h_Light": ("Tools", "Cutteray Mk2 (Light 1H)"),
        "MiningTool_1h_Unique_01": ("Tools", "Unique Cutteray Mk1"),
        "MiningTool_2h_Standard": ("Tools", "Cutteray Mk4 (2-Handed)"),
        "RepairTool3": ("Tools", "Welding Torch Mk3"),
        "HandHeldTorch": ("Tools", "Handheld Torch"),
        "PortableLight": ("Tools", "Portable Light"),
        "Scanner_Base_1": ("Tools", "Scanner Base Mk1"),
        "SurveyProbe_1": ("Tools", "Survey Probe"),
        "SuspensorBelt": ("Tools", "Suspensor Belt"),
        "PartialStabilizationBelt": ("Tools", "Partial Stabilization Belt"),
        "Radiation_Suit": ("Tools", "Radiation Suit"),
        "PowerPack_Unique_Regen_01": ("Tools", "Unique Power Pack (Regen)"),
        "VehicleBackupTool": ("Tools", "Vehicle Backup Tool"),
        # Consumables
        "healthpack_channeled_2": ("Consumables", "Healkit Mk2"),
        "healthpack_channeled_4": ("Consumables", "Healkit Mk4"),
        "HighCapacityLiterjon": ("Consumables", "High Capacity Literjon"),
        # Resources
        "Basalt": ("Resources", "Basalt"),
        "DolomiteRock": ("Resources", "Dolomite"),
        "MagnetiteOre": ("Resources", "Magnetite Ore"),
        "WormTooth": ("Resources", "Worm Tooth"),
        # Contracts
        "ContractFactionFalsifiedCommunicationsLog": ("Contracts", "Faction: Falsified Comms Log"),
        "ContractPlanetologist1AReels": ("Contracts", "Planetologist 1A: Reels"),
        "ContractPlanetologist2AReels": ("Contracts", "Planetologist 2A: Reels"),
        # Emotes
        "Emote_ExamineGround": ("Emotes", "Examine Ground"),
        "Emote_ScanHorizon": ("Emotes", "Scan Horizon"),
        "Emote_ThumperBack": ("Emotes", "Thumper (Back)"),
        "Emote_ThumperForward": ("Emotes", "Thumper (Forward)"),
        "Emote_ThumperLeft": ("Emotes", "Thumper (Left)"),
        "Emote_ThumperRight": ("Emotes", "Thumper (Right)"),
        "Emote_WatershipperFreeze": ("Emotes", "Watershipper Freeze"),
        "Emote_WatershipperSalute": ("Emotes", "Watershipper Salute"),
        "Emote_WormSign": ("Emotes", "Worm Sign"),
        # Vehicles — mid-tier parts
        "SandbikeBoost_2": ("Vehicles", "Sandbike Booster Mk2"),
        "SandbikeBoost_3": ("Vehicles", "Sandbike Booster Mk3"),
        "SandbikeBoost_4": ("Vehicles", "Sandbike Booster Mk4"),
        "SandbikeEngine_3": ("Vehicles", "Sandbike Engine Mk3"),
        "SandbikeHull_1": ("Vehicles", "Sandbike Hull Mk1"),
        "BuggyBoost_3": ("Vehicles", "Buggy Booster Mk3"),
        "BuggyBoost_4": ("Vehicles", "Buggy Booster Mk4"),
        "BuggyGenerator_3": ("Vehicles", "Buggy Generator Mk3"),
        "BuggyInventory_3": ("Vehicles", "Buggy Inventory Mk3"),
        "BuggyMining_3": ("Vehicles", "Buggy Mining Attachment Mk3"),
        "OrnithopterTransportEngine_6": ("Vehicles", "Transport Ornithopter Engine Mk6"),
        # Misc (verified real, purpose unclear)
        "t2tsp": ("Misc", "T2 TSP"),
        "wy1ll": ("Misc", "WY1LL"),

        "SandcrawlerSpiceContainer_Unique_Capacity_6": ("Vehicles Unique", "Upgraded Regis Spice Container"),
    }

    async def list_item_templates(self, search: str | None = None) -> dict[str, Any]:
        """List item template_ids from DB items, recipes, and known catalog."""
        pool = getattr(self.postgres_service, "pool", None) if self.postgres_service else None
        if pool is None:
            return {"templates": [], "total": 0}

        async with pool.acquire() as connection:
            # Get templates from existing items
            if search:
                item_rows = await connection.fetch("""
                    SELECT DISTINCT template_id, COUNT(*) as count
                    FROM dune.items
                    WHERE template_id ILIKE $1
                    GROUP BY template_id
                    ORDER BY template_id
                    LIMIT 100
                """, f"%{search}%")
            else:
                item_rows = await connection.fetch("""
                    SELECT DISTINCT template_id, COUNT(*) as count
                    FROM dune.items
                    GROUP BY template_id
                    ORDER BY count DESC, template_id
                    LIMIT 200
                """)

            # Extract template IDs from recipe names (strip _Recipe suffix)
            recipe_rows = await connection.fetch("""
                SELECT DISTINCT
                    regexp_replace(
                        (elem->>'Name'),
                        '(?:Recipe|_Recipe)$', ''
                    ) as template_id
                FROM dune.actors,
                     jsonb_array_elements(
                         properties->'CraftingRecipesLibraryActorComponent'->'m_KnownItemRecipes'
                     ) recipe,
                     jsonb_extract_path(recipe, 'BaseRecipeId') elem
                WHERE properties ? 'CraftingRecipesLibraryActorComponent'
                LIMIT 500
            """)

        # Merge all sources: DB items, recipes, and known catalog
        seen: dict[str, dict[str, Any]] = {}

        def _resolve(tid: str) -> tuple[str, str]:
            """Return (category, display_name) for a template_id."""
            entry = self.KNOWN_TEMPLATES.get(tid)
            if entry:
                return entry  # (category, name)
            return ("Unknown", tid)

        # DB items (with counts)
        for r in item_rows:
            tid = r["template_id"]
            cat, name = _resolve(tid)
            seen[tid] = {
                "id": tid,
                "name": name,
                "count": int(r["count"]),
                "source": "inventory",
                "category": cat,
            }

        # Recipe-derived templates
        for r in recipe_rows:
            tid = r["template_id"]
            if tid and tid not in seen:
                cat, name = _resolve(tid)
                seen[tid] = {
                    "id": tid,
                    "name": name,
                    "count": 0,
                    "source": "recipe",
                    "category": cat,
                }

        # Known catalog items not yet in DB or recipes
        for tid, (category, name) in self.KNOWN_TEMPLATES.items():
            if tid not in seen:
                seen[tid] = {
                    "id": tid,
                    "name": name,
                    "count": 0,
                    "source": "catalog",
                    "category": category,
                }

        # Filter by search if provided (searches id, name, and category)
        templates = list(seen.values())
        if search:
            s = search.lower()
            templates = [
                t for t in templates
                if s in t["id"].lower() or s in t["name"].lower() or s in t["category"].lower()
            ]

        # Sort: items with counts first, then alphabetically
        templates.sort(key=lambda t: (-t["count"], t["category"], t["name"]))
        return {"templates": templates[:300], "total": len(templates)}

    def get_editable_stats(self) -> list[dict[str, str]]:
        return EDITABLE_STATS

    def get_summary(self) -> dict[str, Any]:
        return {
            "mutationsEnabled": self.mutations_enabled,
            "editableStats": len(EDITABLE_STATS),
            "categories": ["stats", "spice", "economy", "specialization"],
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
        """Update a character in the Funcom DB. character_id is ea.id (text)."""
        import json

        if not updates:
            character = await self.get_character(character_id)
            if character is None:
                raise KeyError(character_id)
            return character

        pool = getattr(self.postgres_service, "pool", None)
        if pool is None:
            return None

        account_id = int(character_id)

        async with pool.acquire() as connection:
            pawn = await connection.fetchrow("""
                SELECT eps.player_pawn_id, eps.player_controller_id
                FROM dune.encrypted_player_state eps
                WHERE eps.account_id = $1
            """, account_id)
            if pawn is None:
                raise KeyError(character_id)

            pawn_id = pawn["player_pawn_id"]
            controller_id = pawn["player_controller_id"]

            for key, value in updates.items():
                numeric_value = float(value)

                if key == "solari":
                    await connection.execute("""
                        INSERT INTO dune.player_virtual_currency_balances
                            (player_controller_id, currency_id, balance)
                        VALUES ($1, 1, $2)
                        ON CONFLICT (player_controller_id, currency_id)
                        DO UPDATE SET balance = $2
                    """, controller_id, int(numeric_value))

                elif key == "max_health":
                    await connection.execute("""
                        UPDATE dune.actors SET properties = jsonb_set(
                            jsonb_set(properties,
                                '{DamageableActorComponent,m_TotalMaxHealth}', $2::jsonb),
                            '{DamageableActorComponent,m_CurrentMaxHealth}', $2::jsonb)
                        WHERE id = $1
                    """, pawn_id, json.dumps(numeric_value))

                elif key == "current_hydration":
                    await connection.execute("""
                        UPDATE dune.actors SET gas_attributes = jsonb_set(
                            jsonb_set(gas_attributes,
                                '{DuneHydrationAttributeSet,CurrentHydration,BaseValue}', $2::jsonb),
                            '{DuneHydrationAttributeSet,CurrentHydration,CurrentValue}', $2::jsonb)
                        WHERE id = $1
                    """, pawn_id, json.dumps(numeric_value))

                elif key == "heat_exhaustion":
                    await connection.execute("""
                        UPDATE dune.actors SET gas_attributes = jsonb_set(
                            jsonb_set(gas_attributes,
                                '{DuneHydrationAttributeSet,HeatExhaustion,BaseValue}', $2::jsonb),
                            '{DuneHydrationAttributeSet,HeatExhaustion,CurrentValue}', $2::jsonb)
                        WHERE id = $1
                    """, pawn_id, json.dumps(numeric_value))

                elif key == "current_spice":
                    await connection.execute("""
                        UPDATE dune.actors SET gas_attributes = jsonb_set(
                            jsonb_set(gas_attributes,
                                '{DuneSpiceAddictionAttributeSet,CurrentSpice,BaseValue}', $2::jsonb),
                            '{DuneSpiceAddictionAttributeSet,CurrentSpice,CurrentValue}', $2::jsonb)
                        WHERE id = $1
                    """, pawn_id, json.dumps(numeric_value))

                elif key == "spice_exposure":
                    await connection.execute("""
                        UPDATE dune.actors SET gas_attributes = jsonb_set(
                            jsonb_set(gas_attributes,
                                '{DuneSpiceAddictionAttributeSet,SpiceExposure,BaseValue}', $2::jsonb),
                            '{DuneSpiceAddictionAttributeSet,SpiceExposure,CurrentValue}', $2::jsonb)
                        WHERE id = $1
                    """, pawn_id, json.dumps(numeric_value))

                elif key == "spice_tolerance":
                    await connection.execute("""
                        UPDATE dune.actors SET gas_attributes = jsonb_set(
                            jsonb_set(gas_attributes,
                                '{DuneSpiceAddictionAttributeSet,SpiceTolerance,BaseValue}', $2::jsonb),
                            '{DuneSpiceAddictionAttributeSet,SpiceTolerance,CurrentValue}', $2::jsonb)
                        WHERE id = $1
                    """, pawn_id, json.dumps(numeric_value))

                elif key == "spice_addiction_level":
                    await connection.execute("""
                        UPDATE dune.actors SET gas_attributes = jsonb_set(
                            jsonb_set(gas_attributes,
                                '{DuneSpiceAddictionAttributeSet,SpiceAddictionLevel,BaseValue}', $2::jsonb),
                            '{DuneSpiceAddictionAttributeSet,SpiceAddictionLevel,CurrentValue}', $2::jsonb)
                        WHERE id = $1
                    """, pawn_id, json.dumps(numeric_value))

                elif key == "dehydration_penalty":
                    await connection.execute("""
                        UPDATE dune.actors SET gas_attributes = jsonb_set(
                            jsonb_set(gas_attributes,
                                '{DuneHydrationAttributeSet,DehydrationPenalty,BaseValue}', $2::jsonb),
                            '{DuneHydrationAttributeSet,DehydrationPenalty,CurrentValue}', $2::jsonb)
                        WHERE id = $1
                    """, pawn_id, json.dumps(numeric_value))

                elif key == "clothing_captured_water":
                    await connection.execute("""
                        UPDATE dune.actors SET gas_attributes = jsonb_set(
                            jsonb_set(gas_attributes,
                                '{DuneHydrationAttributeSet,ClothingCapturedWater,BaseValue}', $2::jsonb),
                            '{DuneHydrationAttributeSet,ClothingCapturedWater,CurrentValue}', $2::jsonb)
                        WHERE id = $1
                    """, pawn_id, json.dumps(numeric_value))

                elif key == "eyes_of_ibad":
                    await connection.execute("""
                        UPDATE dune.actors SET properties = jsonb_set(
                            properties,
                            '{BP_DunePlayerCharacter_C,m_EyesOfIbadValue}', $2::jsonb)
                        WHERE id = $1
                    """, pawn_id, json.dumps(numeric_value))

                elif key == "tech_knowledge_points":
                    await connection.execute("""
                        UPDATE dune.actors SET properties = jsonb_set(
                            properties,
                            '{TechKnowledgePlayerComponent,m_TechKnowledgePoints}', $2::jsonb)
                        WHERE id = $1
                    """, pawn_id, json.dumps(int(numeric_value)))

                else:
                    logger.warning("Unknown editable stat key: %s", key)

        return await self.get_character(character_id)

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
            "table": table.replace("_", "-"),
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
