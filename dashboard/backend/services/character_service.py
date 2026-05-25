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

    async def get_inventory(self, character_id: str) -> dict[str, Any]:
        """Get all items in a character's inventories."""
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
                    SELECT id FROM dune.actors WHERE owner_account_id = $1
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

        pool = getattr(self.postgres_service, "pool", None) if self.postgres_service else None
        if pool is None:
            raise PermissionError("No database connection")

        account_id = int(character_id)
        async with pool.acquire() as connection:
            # Find the player's backpack inventory (type 0)
            inv = await connection.fetchrow("""
                SELECT i.id AS inventory_id
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

            # Find the next open position_index in the backpack
            max_pos = await connection.fetchval("""
                SELECT COALESCE(MAX(position_index), -1) + 1
                FROM dune.items WHERE inventory_id = $1
            """, inventory_id)

            # Insert the item with proper stats JSON that the game engine expects.
            # Without FItemStackAndDurabilityStats the game silently skips the item.
            import json
            import time

            item_stats = {"FItemStackAndDurabilityStats": [[], {"DecayedMaxDurability": 0.0}]}
            new_item_id = await connection.fetchval("""
                INSERT INTO dune.items
                    (inventory_id, template_id, stack_size, position_index,
                     quality_level, is_new, acquisition_time, stats)
                VALUES ($1, $2, $3, $4, $5, true, $6, $7::jsonb)
                RETURNING id
            """, inventory_id, template_id, stack_size, max_pos,
                quality_level, int(time.time()), json.dumps(item_stats))

            logger.info(
                "Granted item %s (x%d) to account %d, item_id=%d",
                template_id, stack_size, account_id, new_item_id,
            )
            return {
                "success": True,
                "item_id": int(new_item_id),
                "template_id": template_id,
                "stack_size": stack_size,
                "inventory_type": "backpack",
                "position_index": int(max_pos),
            }

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
        """Teleport a character by updating their actor transform. Takes effect on relog."""
        if not self.mutations_enabled:
            raise PermissionError("Mutations disabled. Set DUNE_ADMIN_MUTATIONS_ENABLED=true")

        pool = getattr(self.postgres_service, "pool", None) if self.postgres_service else None
        if pool is None:
            raise PermissionError("No database connection")

        account_id = int(character_id)
        async with pool.acquire() as connection:
            pawn = await connection.fetchrow("""
                SELECT eps.player_pawn_id
                FROM dune.encrypted_player_state eps
                WHERE eps.account_id = $1
            """, account_id)
            if pawn is None:
                raise KeyError(character_id)

            pawn_id = pawn["player_pawn_id"]

            # Update transform keeping existing rotation
            await connection.execute("""
                UPDATE dune.actors
                SET transform = ROW(
                    ROW($2, $3, $4)::vector,
                    (transform).rotation
                )::transform
                WHERE id = $1
            """, pawn_id, x, y, z)

            logger.info("Teleported account %d to (%.1f, %.1f, %.1f)", account_id, x, y, z)
            return {
                "success": True,
                "character_id": character_id,
                "position": {"x": x, "y": y, "z": z},
                "note": "Player must relog for teleport to take effect.",
            }

    # Known item template IDs derived from recipes and game data.
    # These may not yet exist in dune.items but are valid for granting.
    KNOWN_TEMPLATES: dict[str, str] = {
        # Weapons
        "ScrapMetalKnife": "Weapons",
        "ChoamSda1": "Weapons",
        "ChoamMaulaPistol": "Weapons",
        "AssaultRifle": "Weapons",
        "T1_MeleeKindjal0": "Weapons",
        "T3_Tool_SurveyProbeLauncher": "Weapons",
        "SurveyProbeLauncher": "Weapons",
        "Ammo": "Weapons",
        "T3_Tool_SurveyProbeAmmo": "Weapons",
        # Tools
        "MiningTool_1h_Standard": "Tools",
        "Binoculars_1": "Tools",
        "T1_Tool_Binoculars": "Tools",
        "BasicBuildingTool": "Tools",
        "BuildingDrone": "Tools",
        "BodyFluidExtractor": "Tools",
        "PowerPack": "Tools",
        "PowerPack5": "Tools",
        "T2_MiscEquipment_PowerPack": "Tools",
        "RepairTool": "Tools",
        "WeldingMaterial": "Tools",
        "PowerUnitVeryLight": "Tools",
        # Resources
        "ScrapMetal": "Resources",
        "Stone": "Resources",
        "PlantFiber": "Resources",
        "Oil": "Resources",
        "AzuriteOre": "Resources",
        "FuelCanister": "Resources",
        "T1UniqueComponent": "Resources",
        "T1ExplorationComponent": "Resources",
        "T2HeavyComponent": "Resources",
        "FremenComponent1": "Resources",
        "FremenComponent2": "Resources",
        "OldImperialComponent1": "Resources",
        "OldImperialComponent2": "Resources",
        "IronBar": "Resources",
        "CopperBar": "Resources",
        "T3_Material_CopperBar": "Resources",
        "T5_Material_SteelBar": "Resources",
        # Consumables
        "HealthPack": "Consumables",
        "healthpack_channeled": "Consumables",
        "Bloodsack_01": "Consumables",
        "BloodSack": "Consumables",
        "Literjon": "Consumables",
        "Exsanguination": "Consumables",
        "SolarisCoin": "Currency",
        # Contracts
        "ContractItem": "Contracts",
        "ContractScavengers1AutomatedPoisonSniffer": "Contracts",
        # Armor - Sandtrout Leathers
        "Combat_Nati_SandtroutLeathers01_Helmet": "Armor",
        "Combat_Nati_SandtroutLeathers01_Top": "Armor",
        "Combat_Nati_SandtroutLeathers01_Bottom": "Armor",
        "Combat_Nati_SandtroutLeathers01_Gloves": "Armor",
        "Combat_Nati_SandtroutLeathers01_Boots": "Armor",
        # Armor - Bandit Leathers
        "T1_Armor_BanditLeathers_Head": "Armor",
        "T1_Armor_BanditLeathers_Chest": "Armor",
        "T1_Armor_BanditLeathers_Legs": "Armor",
        "T1_Armor_BanditLeathers_Hands": "Armor",
        "T1_Armor_BanditLeathers_Feet": "Armor",
        # Armor - Scavenger Rags
        "ScavengerRags_Helmet": "Armor",
        "ScavengerRags_Top": "Armor",
        "ScavengerRags_Bottom": "Armor",
        "ScavengerRags_Gloves": "Armor",
        "ScavengerRags_Boots": "Armor",
        # Armor - Leaky Stillsuit
        "LeakyStillsuit_Boots": "Armor",
        "LeakyStillsuit_Gloves": "Armor",
        "LeakyStillsuit_Mask": "Armor",
        "LeakyStillsuit_Top": "Armor",
        "Stillsuit_Neut_Leaking01_Boots": "Armor",
        "Stillsuit_Neut_Leaking01_Gloves": "Armor",
        "Stillsuit_Neut_Leaking01_Mask": "Armor",
        "Stillsuit_Neut_Leaking01_Top": "Armor",
        # Social / Cosmetics
        "Social_Choam_MaulaCastOffs01_Bottom": "Cosmetics",
        "Social_Choam_MaulaCastOffs01_Gloves": "Cosmetics",
        "Social_Choam_MaulaCastOffs01_Shoes": "Cosmetics",
        "Social_Choam_MaulaCastOffs01_Top_Fremkit": "Cosmetics",
        # Vehicle Parts
        "T2_Vehicle_Ground__SandBikeBodyHull": "Vehicle Parts",
        "T2_Vehicle_Ground__SandBikeChassis": "Vehicle Parts",
        "T2_SandbikeEngine": "Vehicle Parts",
        "T2_Vehicle_Ground__SandBikeTreads": "Vehicle Parts",
        "T2_Vehicle_Ground__SandBikeInventoryModule": "Vehicle Parts",
        "SandbikeEngine_1": "Vehicle Parts",
        "SandbikeLocomotion_1": "Vehicle Parts",
        "SandbikeSeat_1": "Vehicle Parts",
        # Schematics
        "SandbikeEngine_Unique_Speed_1_Schematic": "Schematics",
        "Stillsuit_Unique_Armored_01_Gloves_Schematic": "Schematics",
        "PowerPack_Unique_Regen_01_Schematic": "Schematics",
        "Schematic_UniqueSuspensor": "Schematics",
        "Schematic_UniqueLiterjon": "Schematics",
        # Structures
        "T1_Structure_RespawnBeacon1": "Structures",
        "RespawnBeacon": "Structures",
        # Emotes
        "Emote_Bow_01": "Emotes",
        "Emote_Clap_01": "Emotes",
        "Emote_Follow_01": "Emotes",
        "Emote_No_01": "Emotes",
        "Emote_Point_01": "Emotes",
        "Emote_Sit_01": "Emotes",
        "Emote_Threaten_01": "Emotes",
        "Emote_Yes_01": "Emotes",
        "Emote_ShakeOffSand_01": "Emotes",
        "Emote_AtreSalute_01": "Emotes",
        "Emote_AdjustStillsuit": "Emotes",
        "Emote_KaitanBow_01": "Emotes",
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

        # DB items (with counts)
        for r in item_rows:
            tid = r["template_id"]
            seen[tid] = {
                "id": tid,
                "count": int(r["count"]),
                "source": "inventory",
                "category": self.KNOWN_TEMPLATES.get(tid, "Unknown"),
            }

        # Recipe-derived templates
        for r in recipe_rows:
            tid = r["template_id"]
            if tid and tid not in seen:
                seen[tid] = {
                    "id": tid,
                    "count": 0,
                    "source": "recipe",
                    "category": self.KNOWN_TEMPLATES.get(tid, "Unknown"),
                }

        # Known catalog items not yet in DB or recipes
        for tid, category in self.KNOWN_TEMPLATES.items():
            if tid not in seen:
                seen[tid] = {
                    "id": tid,
                    "count": 0,
                    "source": "catalog",
                    "category": category,
                }

        # Filter by search if provided
        templates = list(seen.values())
        if search:
            s = search.lower()
            templates = [t for t in templates if s in t["id"].lower() or s in t["category"].lower()]

        # Sort: items with counts first, then alphabetically
        templates.sort(key=lambda t: (-t["count"], t["category"], t["id"]))
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
