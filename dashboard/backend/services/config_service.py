from __future__ import annotations

import asyncio
import configparser
import hashlib
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from db.models import ConfigBackup
from models.config import ConfigField, ConfigFile, ConfigUpdate

logger = logging.getLogger(__name__)


class ConfigService:
    def __init__(self, config_dir: str | None = None) -> None:
        self.config_dir = Path(config_dir or os.getenv("DUNE_CONFIG_DIR", "/config"))
        self.allowed_files = {
            "UserGame.ini",
            "UserEngine.ini",
            "director.ini",
            "gateway.ini",
        }
        self.field_definitions: dict[str, dict[str, ConfigField]] = {
            "UserGame.ini": {
                "m_bShouldForceEnablePvpOnAllPartitions": ConfigField(
                    key="m_bShouldForceEnablePvpOnAllPartitions",
                    type="bool",
                    description="When enabled, PvP is forced on every partition regardless of zone type. Disable to respect PvE safe zones.",
                    default_value="False",
                ),
                "m_bAreSecurityZonesEnabled": ConfigField(
                    key="m_bAreSecurityZonesEnabled",
                    type="bool",
                    description="Enable protected security zones around player bases where PvP combat is restricted.",
                    default_value="True",
                ),
                "m_bCoriolisAutoSpawnEnabled": ConfigField(
                    key="m_bCoriolisAutoSpawnEnabled",
                    type="bool",
                    description="Automatically spawn Coriolis storms on the map at regular intervals.",
                    default_value="True",
                ),
                "m_bAutoSpawnEnabled": ConfigField(
                    key="m_bAutoSpawnEnabled",
                    type="bool",
                    description="Automatically spawn standard sandstorms.",
                    default_value="True",
                ),
                "m_DefaultReconnectGracePeriodSeconds": ConfigField(
                    key="m_DefaultReconnectGracePeriodSeconds",
                    type="int",
                    description="Seconds a disconnected player's character stays in-world before despawning. Set to 0 for instant despawn (good for Steam Deck users).",
                    default_value="0",
                    min_value="0",
                    max_value="300",
                    options=[
                        {"value": "0", "label": "0 (instant despawn)"},
                        {"value": "30", "label": "30 seconds"},
                        {"value": "60", "label": "1 minute"},
                        {"value": "120", "label": "2 minutes"},
                        {"value": "300", "label": "5 minutes"},
                    ],
                ),
                "m_OvermapReturnGracePeriodSeconds": ConfigField(
                    key="m_OvermapReturnGracePeriodSeconds",
                    type="int",
                    description="Seconds a player who disconnects on the Overmap (the cross-map travel hub) stays in-world before despawning. Kept short so the hub does not fill with disconnected travellers.",
                    default_value="90",
                    min_value="0",
                    max_value="600",
                    options=[
                        {"value": "0", "label": "0 (instant despawn)"},
                        {"value": "30", "label": "30 seconds"},
                        {"value": "60", "label": "1 minute"},
                        {"value": "90", "label": "90 seconds (default)"},
                        {"value": "120", "label": "2 minutes"},
                        {"value": "300", "label": "5 minutes"},
                    ],
                ),
                "m_InstancedMapReconnectGracePeriodSeconds": ConfigField(
                    key="m_InstancedMapReconnectGracePeriodSeconds",
                    type="int",
                    description="Seconds a player who disconnects inside an instanced map (story or dungeon instance) can reconnect before the instance releases their slot.",
                    default_value="600",
                    min_value="0",
                    max_value="3600",
                    options=[
                        {"value": "0", "label": "0 (instant release)"},
                        {"value": "60", "label": "1 minute"},
                        {"value": "300", "label": "5 minutes"},
                        {"value": "600", "label": "10 minutes (default)"},
                        {"value": "900", "label": "15 minutes"},
                        {"value": "1800", "label": "30 minutes"},
                    ],
                ),
                "m_MaxNumLandclaimSegments": ConfigField(
                    key="m_MaxNumLandclaimSegments",
                    type="int",
                    description="Maximum number of land claim segments allowed per map. Controls how much territory players can claim.",
                    default_value="10",
                    min_value="5",
                    max_value="100",
                    options=[
                        {"value": "5", "label": "5 (restrictive)"},
                        {"value": "10", "label": "10 (default)"},
                        {"value": "20", "label": "20 (generous)"},
                        {"value": "50", "label": "50 (very generous)"},
                        {"value": "100", "label": "100 (unlimited feel)"},
                    ],
                ),
                "m_BaseBackupToolTimeRestrictionInSeconds": ConfigField(
                    key="m_BaseBackupToolTimeRestrictionInSeconds",
                    type="int",
                    description="Cooldown in seconds before a base backup tool can be used again. Default 604800 = 7 days. Lower values allow more frequent base backups.",
                    default_value="604800",
                    min_value="60",
                    max_value="604800",
                    options=[
                        {"value": "60", "label": "60 seconds (testing)"},
                        {"value": "3600", "label": "1 hour"},
                        {"value": "86400", "label": "1 day"},
                        {"value": "259200", "label": "3 days"},
                        {"value": "604800", "label": "7 days (default)"},
                    ],
                ),
                "Port": ConfigField(
                    key="Port",
                    type="int",
                    description="Starting UDP port for game server connections. Changing this requires updating your port forwarding rules.",
                    default_value="7777",
                ),
                "IGWPort": ConfigField(
                    key="IGWPort",
                    type="int",
                    description="Starting port for In-Game Web (IGW) traffic used by the director for internal communication.",
                    default_value="7888",
                ),
                "NetServerMaxTickRate": ConfigField(
                    key="NetServerMaxTickRate",
                    type="int",
                    description="Network tick rate for the game server. Higher values mean smoother gameplay but more CPU/bandwidth usage.",
                    default_value="60",
                ),
                # --- Sandworm Settings ---
                "m_bGiantWormSystemEnabled": ConfigField(
                    key="m_bGiantWormSystemEnabled",
                    type="bool",
                    description="Enable Shai-Hulud (giant worm) spawns. Disable to remove the biggest threat.",
                    default_value="True",
                ),
                "m_GiantWormSpawningCooldown": ConfigField(
                    key="m_GiantWormSpawningCooldown",
                    type="float",
                    description="Seconds between giant worm spawn attempts. Higher = fewer worms.",
                    default_value="300",
                    min_value="1800",
                    max_value="28800",
                    options=[
                        {"value": "1800", "label": "30 minutes (frequent)"},
                        {"value": "3600", "label": "1 hour"},
                        {"value": "5400", "label": "1.5 hours"},
                        {"value": "7200", "label": "2 hours (default)"},
                        {"value": "14400", "label": "4 hours (rare)"},
                        {"value": "28800", "label": "8 hours (very rare)"},
                    ],
                ),
                "m_GiantWormMinimumPlayersOnSpiceField": ConfigField(
                    key="m_GiantWormMinimumPlayersOnSpiceField",
                    type="int",
                    description="Minimum players harvesting spice before Shai-Hulud can spawn. Higher = safer solo play.",
                    default_value="1",
                    min_value="1",
                    max_value="99",
                    options=[
                        {"value": "1", "label": "1 (always dangerous)"},
                        {"value": "2", "label": "2"},
                        {"value": "4", "label": "4 (default)"},
                        {"value": "8", "label": "8 (group only)"},
                        {"value": "99", "label": "99 (effectively disabled)"},
                    ],
                ),
                "ThreatScale": ConfigField(
                    key="ThreatScale",
                    type="float",
                    description="Global worm threat multiplier. Higher = worms detect players faster.",
                    default_value="1.0",
                    min_value="0.25",
                    max_value="2.0",
                    options=[
                        {"value": "0.25", "label": "0.25x (very passive)"},
                        {"value": "0.5", "label": "0.5x (relaxed)"},
                        {"value": "1.0", "label": "1.0x (default)"},
                        {"value": "1.5", "label": "1.5x (aggressive)"},
                        {"value": "2.0", "label": "2.0x (very aggressive)"},
                    ],
                ),
                # --- Enemy/NPC Settings ---
                "m_MaxReinforcementSize": ConfigField(
                    key="m_MaxReinforcementSize",
                    type="int",
                    description="Maximum NPC reinforcement group size. Lower = fewer enemies per encounter.",
                    default_value="150",
                    min_value="50",
                    max_value="300",
                    options=[
                        {"value": "50", "label": "50 (easy encounters)"},
                        {"value": "100", "label": "100 (moderate)"},
                        {"value": "150", "label": "150 (default)"},
                        {"value": "200", "label": "200 (challenging)"},
                        {"value": "300", "label": "300 (brutal)"},
                    ],
                ),
                "m_ThreatDecayPerSecond": ConfigField(
                    key="m_ThreatDecayPerSecond",
                    type="float",
                    description="How fast NPC aggro decays per second. Lower = enemies stay angry longer.",
                    default_value="0.1",
                    min_value="0.05",
                    max_value="0.5",
                    options=[
                        {"value": "0.05", "label": "0.05 (persistent aggro)"},
                        {"value": "0.1", "label": "0.1 (default)"},
                        {"value": "0.2", "label": "0.2 (forgetful)"},
                        {"value": "0.5", "label": "0.5 (very forgetful)"},
                    ],
                ),
                # --- Loot Settings ---
                "m_bShouldPlayersDropLootOnDeath": ConfigField(
                    key="m_bShouldPlayersDropLootOnDeath",
                    type="bool",
                    description="Whether players drop their gear on death. Disable for a more casual experience.",
                    default_value="False",
                ),
                "m_bShouldPlayersLoseItemsOnDeath": ConfigField(
                    key="m_bShouldPlayersLoseItemsOnDeath",
                    type="bool",
                    description="Whether players permanently lose items on death. Disable to keep all items.",
                    default_value="False",
                ),
                "m_bShouldNpcDropLootOnDeath": ConfigField(
                    key="m_bShouldNpcDropLootOnDeath",
                    type="bool",
                    description="Whether NPCs drop loot when killed. Disable to remove NPC loot drops entirely.",
                    default_value="True",
                ),
                # --- Day/Night & Weather ---
                "m_DayLengthMinutes": ConfigField(
                    key="m_DayLengthMinutes",
                    type="float",
                    description="Length of one full in-game day in real minutes. Higher = slower day/night cycle.",
                    default_value="30",
                    min_value="15",
                    max_value="120",
                    options=[
                        {"value": "15", "label": "15 min (fast cycle)"},
                        {"value": "30", "label": "30 min (default)"},
                        {"value": "45", "label": "45 min (relaxed)"},
                        {"value": "60", "label": "60 min (slow)"},
                        {"value": "120", "label": "2 hours (very slow)"},
                    ],
                ),
                "m_bAutoSpawnEnabled": ConfigField(
                    key="m_bAutoSpawnEnabled",
                    type="bool",
                    description="Enable automatic sandstorm spawning. Disable for calm weather.",
                    default_value="True",
                ),
                "m_bMitigateAllSandstormDamage": ConfigField(
                    key="m_bMitigateAllSandstormDamage",
                    type="bool",
                    description="When enabled, buildings and placeables are immune to sandstorm damage.",
                    default_value="False",
                ),
                # --- Crafting ---
                "m_RepairCostWeight": ConfigField(
                    key="m_RepairCostWeight",
                    type="float",
                    description="Repair cost as fraction of crafting cost. Lower = cheaper repairs.",
                    default_value="0.5",
                    min_value="0.1",
                    max_value="1.0",
                    options=[
                        {"value": "0.1", "label": "10% (very cheap)"},
                        {"value": "0.25", "label": "25% (cheap)"},
                        {"value": "0.5", "label": "50% (default)"},
                        {"value": "0.75", "label": "75% (expensive)"},
                        {"value": "1.0", "label": "100% (full price)"},
                    ],
                ),
                "m_RecyclerOutputWeight": ConfigField(
                    key="m_RecyclerOutputWeight",
                    type="float",
                    description="Recycler/dismantler output as fraction of original materials. Higher = more materials back.",
                    default_value="0.25",
                    min_value="0.1",
                    max_value="1.0",
                    options=[
                        {"value": "0.1", "label": "10% (minimal return)"},
                        {"value": "0.25", "label": "25% (default)"},
                        {"value": "0.5", "label": "50% (generous)"},
                        {"value": "0.75", "label": "75% (very generous)"},
                        {"value": "1.0", "label": "100% (full return)"},
                    ],
                ),
                # --- Hydration ---
                "m_bHydrationEnabled": ConfigField(
                    key="m_bHydrationEnabled",
                    type="bool",
                    description="Enable the hydration/thirst system. Disable for a more relaxed survival experience.",
                    default_value="True",
                ),
                "m_BuildingBlueprintMaxExtensions": ConfigField(
                    key="m_BuildingBlueprintMaxExtensions",
                    type="int",
                    description="Max times a building blueprint slot can be extended before requiring re-place.",
                    default_value="4",
                    min_value="1",
                    max_value="16",
                    options=[
                        {"value": "1", "label": "1"},
                        {"value": "2", "label": "2"},
                        {"value": "4", "label": "4"},
                        {"value": "8", "label": "8"},
                        {"value": "16", "label": "16"},
                    ],
                ),
                "m_bBuildingRestrictionLimitsEnabled": ConfigField(
                    key="m_bBuildingRestrictionLimitsEnabled",
                    type="bool",
                    description="Enforce building restriction limits (placement rules and structure caps). Disable to allow unrestricted building. Must also be applied to each client to take full effect.",
                    default_value="True",
                ),
                "m_BaseBackupMaxExtensions": ConfigField(
                    key="m_BaseBackupMaxExtensions",
                    type="int",
                    description="Max number of base backup extensions per base.",
                    default_value="8",
                    min_value="1",
                    max_value="32",
                    options=[
                        {"value": "1", "label": "1"},
                        {"value": "4", "label": "4"},
                        {"value": "8", "label": "8"},
                        {"value": "16", "label": "16"},
                        {"value": "32", "label": "32"},
                    ],
                ),
                "m_MaxGuildMembersAllowed": ConfigField(
                    key="m_MaxGuildMembersAllowed",
                    type="int",
                    description="Maximum members per guild.",
                    default_value="32",
                    min_value="8",
                    max_value="128",
                    options=[
                        {"value": "8", "label": "8"},
                        {"value": "16", "label": "16"},
                        {"value": "32", "label": "32"},
                        {"value": "64", "label": "64"},
                        {"value": "128", "label": "128"},
                    ],
                ),
                "m_MaxGuildsAllowed": ConfigField(
                    key="m_MaxGuildsAllowed",
                    type="int",
                    description="Max guilds a single player can join.",
                    default_value="3",
                    min_value="1",
                    max_value="5",
                    options=[
                        {"value": "1", "label": "1"},
                        {"value": "2", "label": "2"},
                        {"value": "3", "label": "3"},
                        {"value": "5", "label": "5"},
                    ],
                ),
                "m_VehicleQuicksandDamage": ConfigField(
                    key="m_VehicleQuicksandDamage",
                    type="float",
                    description="Damage applied to vehicles caught in quicksand.",
                    default_value="10000.0",
                    min_value="0",
                    max_value="20000",
                    options=[
                        {"value": "0", "label": "0 (disabled)"},
                        {"value": "1000", "label": "1,000"},
                        {"value": "5000", "label": "5,000"},
                        {"value": "10000", "label": "10,000 (Funcom default)"},
                        {"value": "20000", "label": "20,000"},
                    ],
                ),
                "NpeGrantDurationInMinutes": ConfigField(
                    key="NpeGrantDurationInMinutes",
                    type="int",
                    description="Duration in minutes that new player experience (NPE) protections last after character creation.",
                    default_value="90",
                    min_value="0",
                    max_value="180",
                    options=[
                        {"value": "0", "label": "0 (disabled)"},
                        {"value": "30", "label": "30 minutes"},
                        {"value": "60", "label": "1 hour"},
                        {"value": "90", "label": "90 minutes (default)"},
                        {"value": "120", "label": "2 hours"},
                        {"value": "180", "label": "3 hours"},
                    ],
                ),
                "m_GuildCreationCost": ConfigField(
                    key="m_GuildCreationCost",
                    type="int",
                    description="Solari cost to create a guild.",
                    default_value="1000",
                    min_value="0",
                    max_value="1000000",
                ),
                "m_MaxPermissionsPerActor": ConfigField(
                    key="m_MaxPermissionsPerActor",
                    type="int",
                    description="Maximum permission entries allowed per actor.",
                    default_value="32",
                    min_value="1",
                    max_value="128",
                ),
                "m_bIsDbWipeEnabled": ConfigField(
                    key="m_bIsDbWipeEnabled",
                    type="bool",
                    description="Enable Coriolis database wipe behavior.",
                    default_value="False",
                ),
                "m_EnableSandwormSystem": ConfigField(
                    key="m_EnableSandwormSystem",
                    type="string",
                    description="Sandworm system mode enum used by the shipped server.",
                    default_value="UseAllowList",
                    options=[{"value": "UseAllowList", "label": "UseAllowList"}],
                ),
                "m_MinDistanceBetweenSandworms": ConfigField(
                    key="m_MinDistanceBetweenSandworms",
                    type="float",
                    description="Minimum distance maintained between sandworms.",
                    default_value="3000",
                    min_value="0",
                    max_value="100000",
                ),
                "PlayerInventoryStartingSize": ConfigField(
                    key="PlayerInventoryStartingSize",
                    type="int",
                    description="Starting player inventory slot count.",
                    default_value="40",
                    min_value="1",
                    max_value="200",
                ),
                "PlayerInventoryStartingVolumeCapacity": ConfigField(
                    key="PlayerInventoryStartingVolumeCapacity",
                    type="float",
                    description="Starting player inventory volume capacity.",
                    default_value="225.0",
                    min_value="0",
                    max_value="10000",
                ),
                "UpdateRateInSeconds": ConfigField(
                    key="UpdateRateInSeconds",
                    type="float",
                    description="Item deterioration update interval in seconds.",
                    default_value="1.0",
                    min_value="0",
                    max_value="5.0",
                ),
                "SellOrderPricePercentageFee": ConfigField(
                    key="SellOrderPricePercentageFee",
                    type="float",
                    description="Exchange sell-order fee percentage.",
                    default_value="0.05",
                    min_value="0",
                    max_value="1",
                ),
                "m_MinimumAugmentableItemQuality": ConfigField(
                    key="m_MinimumAugmentableItemQuality",
                    type="string",
                    description="Minimum item quality that can receive augments.",
                    default_value="Uncommon",
                ),
                "+Dune.GlobalMiningOutputMultiplier": ConfigField(
                    key="+Dune.GlobalMiningOutputMultiplier",
                    type="float",
                    description="Console variable: hand mining output multiplier.",
                    default_value="1.0",
                    min_value="0",
                    max_value="5.0",
                ),
                "+Dune.GlobalVehicleMiningOutputMultiplier": ConfigField(
                    key="+Dune.GlobalVehicleMiningOutputMultiplier",
                    type="float",
                    description="Console variable: vehicle mining output multiplier.",
                    default_value="1.0",
                    min_value="0",
                    max_value="5.0",
                ),
                "+SecurityZones.PvpResourceMultiplier": ConfigField(
                    key="+SecurityZones.PvpResourceMultiplier",
                    type="float",
                    description="Console variable: resource multiplier in PvP security-zone areas.",
                    default_value="2.5",
                    min_value="0",
                    max_value="5.0",
                ),
                "+dw.VehicleDurabilityDamageMultiplier": ConfigField(
                    key="+dw.VehicleDurabilityDamageMultiplier",
                    type="float",
                    description="Console variable: vehicle durability damage multiplier.",
                    default_value="1.0",
                    min_value="0",
                    max_value="2.0",
                ),
                "+sandworm.dune.Enabled": ConfigField(
                    key="+sandworm.dune.Enabled",
                    type="int",
                    description="Console variable: master sandworm toggle.",
                    default_value="1",
                    min_value="0",
                    max_value="1",
                    options=[{"value": "0", "label": "Disabled"}, {"value": "1", "label": "Enabled"}],
                ),
                "+Vehicle.SandwormCollisionInteraction": ConfigField(
                    key="+Vehicle.SandwormCollisionInteraction",
                    type="bool",
                    description="Console variable: allow sandworms to interact with vehicles.",
                    default_value="False",
                ),
                "+Sandstorm.Enabled": ConfigField(
                    key="+Sandstorm.Enabled",
                    type="bool",
                    description="Console variable: enable normal sandstorms.",
                    default_value="True",
                ),
                "+Sandstorm.Treasure.Enabled": ConfigField(
                    key="+Sandstorm.Treasure.Enabled",
                    type="bool",
                    description="Console variable: enable sandstorm treasure rewards.",
                    default_value="True",
                ),
                "+Sandworm.SandwormDangerZonesEnabled": ConfigField(
                    key="+Sandworm.SandwormDangerZonesEnabled",
                    type="bool",
                    description="Console variable: enable sandworm danger zones.",
                    default_value="True",
                ),
            },
            "UserEngine.ini": {
                "NetServerMaxTickRate": ConfigField(
                    key="NetServerMaxTickRate",
                    type="int",
                    description="Network tick rate for the server engine. Higher values = smoother but more resource-intensive.",
                    default_value="60",
                    options=[
                        {"value": "30", "label": "30 (low, saves CPU)"},
                        {"value": "60", "label": "60 (default)"},
                        {"value": "120", "label": "120 (high, smoother)"},
                    ],
                ),
                "MaxClientRate": ConfigField(
                    key="MaxClientRate",
                    type="int",
                    description="Maximum bytes per second the server will send to a single client.",
                    default_value="100000",
                    options=[
                        {"value": "50000", "label": "50,000 (conservative)"},
                        {"value": "100000", "label": "100,000 (default)"},
                        {"value": "200000", "label": "200,000 (high bandwidth)"},
                        {"value": "500000", "label": "500,000 (very high)"},
                    ],
                ),
                "MaxInternetClientRate": ConfigField(
                    key="MaxInternetClientRate",
                    type="int",
                    description="Maximum bytes per second for internet-connected clients. Should match or exceed MaxClientRate.",
                    default_value="100000",
                    options=[
                        {"value": "50000", "label": "50,000 (conservative)"},
                        {"value": "100000", "label": "100,000 (default)"},
                        {"value": "200000", "label": "200,000 (high bandwidth)"},
                        {"value": "500000", "label": "500,000 (very high)"},
                    ],
                ),
                # --- Game Tweaks (ConsoleVariables) ---
                "sandworm.dune.Enabled": ConfigField(
                    key="sandworm.dune.Enabled",
                    type="int",
                    description="Master toggle for sandworms. Set to 0 to completely disable worm spawns.",
                    default_value="1",
                    min_value="0",
                    max_value="1",
                    options=[
                        {"value": "0", "label": "Disabled"},
                        {"value": "1", "label": "Enabled (default)"},
                    ],
                ),
                "Vehicle.SandwormCollisionInteraction": ConfigField(
                    key="Vehicle.SandwormCollisionInteraction",
                    type="bool",
                    description="Whether sandworms can damage and push vehicles. Disable for safer vehicle travel.",
                    default_value="false",
                ),
                "Dune.GlobalMiningOutputMultiplier": ConfigField(
                    key="Dune.GlobalMiningOutputMultiplier",
                    type="float",
                    description="Multiplier for hand-mining resource output. Higher = more resources per swing.",
                    default_value="1.0",
                    min_value="0.5",
                    max_value="5.0",
                    options=[
                        {"value": "0.5", "label": "0.5x (scarce)"},
                        {"value": "1.0", "label": "1.0x (default)"},
                        {"value": "1.5", "label": "1.5x (boosted)"},
                        {"value": "2.0", "label": "2.0x (generous)"},
                        {"value": "2.5", "label": "2.5x (very generous)"},
                        {"value": "5.0", "label": "5.0x (abundant)"},
                    ],
                ),
                "Dune.GlobalVehicleMiningOutputMultiplier": ConfigField(
                    key="Dune.GlobalVehicleMiningOutputMultiplier",
                    type="float",
                    description="Multiplier for vehicle mining output (harvester yield).",
                    default_value="1.0",
                    min_value="0.5",
                    max_value="5.0",
                    options=[
                        {"value": "0.5", "label": "0.5x (scarce)"},
                        {"value": "1.0", "label": "1.0x (default)"},
                        {"value": "2.0", "label": "2.0x (generous)"},
                        {"value": "2.5", "label": "2.5x (very generous)"},
                        {"value": "5.0", "label": "5.0x (abundant)"},
                    ],
                ),
                "SecurityZones.PvpResourceMultiplier": ConfigField(
                    key="SecurityZones.PvpResourceMultiplier",
                    type="float",
                    description="Resource bonus multiplier in PvP zones. Rewards risk-taking in dangerous areas.",
                    default_value="2.5",
                    options=[
                        {"value": "1.0", "label": "1.0x (no bonus)"},
                        {"value": "1.5", "label": "1.5x"},
                        {"value": "2.0", "label": "2.0x"},
                        {"value": "2.5", "label": "2.5x (default)"},
                        {"value": "5.0", "label": "5.0x (high reward)"},
                    ],
                ),
                "dw.VehicleDurabilityDamageMultiplier": ConfigField(
                    key="dw.VehicleDurabilityDamageMultiplier",
                    type="float",
                    description="Vehicle durability damage multiplier. Lower values make vehicles last longer. 0 = indestructible.",
                    default_value="1.0",
                    min_value="0.0",
                    max_value="2.0",
                    options=[
                        {"value": "0.0", "label": "0 (indestructible)"},
                        {"value": "0.5", "label": "0.5x (durable)"},
                        {"value": "0.75", "label": "0.75x (sturdy)"},
                        {"value": "1.0", "label": "1.0x (default)"},
                        {"value": "2.0", "label": "2.0x (fragile)"},
                    ],
                ),
            },
            "director.ini": {
                "AuthorizationPreset": ConfigField(
                    key="AuthorizationPreset",
                    type="string",
                    description="Authentication preset used by the battlegroup director. BattlegroupInternal is standard for self-hosted servers.",
                    default_value="BattlegroupInternal",
                    options=[
                        {"value": "BattlegroupInternal", "label": "Battlegroup Internal (self-hosted)"},
                        {"value": "BattlegroupExternal", "label": "Battlegroup External (official)"},
                    ],
                ),
                "Overmap": ConfigField(
                    key="Overmap",
                    type="string",
                    description="Instancing mode for the Overmap. SingleServer = one shared instance. Dimension = multiple parallel instances.",
                    default_value="SingleServer",
                    options=[
                        {"value": "SingleServer", "label": "Single Server (one shared instance)"},
                        {"value": "Dimension", "label": "Dimension (parallel instances)"},
                        {"value": "ClassicalInstancing", "label": "Classical Instancing (dynamic scaling)"},
                    ],
                ),
                "Survival_1": ConfigField(
                    key="Survival_1",
                    type="string",
                    description="Instancing mode for Hagga Basin (Survival). Dimension = players distributed across instances. ClassicalInstancing = dynamic scaling.",
                    default_value="Dimension",
                    options=[
                        {"value": "SingleServer", "label": "Single Server (one shared instance)"},
                        {"value": "Dimension", "label": "Dimension (parallel instances)"},
                        {"value": "ClassicalInstancing", "label": "Classical Instancing (dynamic scaling)"},
                    ],
                ),
                "DeepDesert_1": ConfigField(
                    key="DeepDesert_1",
                    type="string",
                    description="Instancing mode for the Deep Desert. ClassicalInstancing = server instances scale dynamically based on player population.",
                    default_value="ClassicalInstancing",
                    options=[
                        {"value": "SingleServer", "label": "Single Server (one shared instance)"},
                        {"value": "Dimension", "label": "Dimension (parallel instances)"},
                        {"value": "ClassicalInstancing", "label": "Classical Instancing (dynamic scaling)"},
                    ],
                ),
                "PlayerHardCap": ConfigField(
                    key="PlayerHardCap",
                    type="int",
                    description="Maximum number of players allowed on this server or map partition.",
                    default_value="40",
                    options=[
                        {"value": "10", "label": "10 (small private)"},
                        {"value": "20", "label": "20 (small group)"},
                        {"value": "40", "label": "40 (default)"},
                        {"value": "60", "label": "60 (medium)"},
                        {"value": "80", "label": "80 (large)"},
                        {"value": "100", "label": "100 (very large)"},
                    ],
                ),
                "ShouldUpdatePlayerCountOnFls": ConfigField(
                    key="ShouldUpdatePlayerCountOnFls",
                    type="bool",
                    description="Report player count to Funcom Live Services. Enable for server browser visibility.",
                    default_value="false",
                ),
                "ForceLock": ConfigField(
                    key="ForceLock",
                    type="bool",
                    description="Lock the server to prevent new player connections. Useful for maintenance windows.",
                    default_value="false",
                ),
                "DauCap": ConfigField(
                    key="DauCap",
                    type="int",
                    description="Daily Active User cap. Maximum unique players allowed per day. Set very high to effectively disable.",
                    default_value="1000000",
                    options=[
                        {"value": "100", "label": "100 (strict)"},
                        {"value": "500", "label": "500 (moderate)"},
                        {"value": "1000", "label": "1,000"},
                        {"value": "10000", "label": "10,000"},
                        {"value": "1000000", "label": "1,000,000 (unlimited)"},
                    ],
                ),
                "WauCap": ConfigField(
                    key="WauCap",
                    type="int",
                    description="Weekly Active User cap. Maximum unique players per week. Default 3360 is the Funcom standard.",
                    default_value="3360",
                    options=[
                        {"value": "100", "label": "100 (strict)"},
                        {"value": "500", "label": "500 (moderate)"},
                        {"value": "3360", "label": "3,360 (Funcom default)"},
                        {"value": "10000", "label": "10,000"},
                        {"value": "1000000", "label": "1,000,000 (unlimited)"},
                    ],
                ),
                "HbsCap": ConfigField(
                    key="HbsCap",
                    type="int",
                    description="Hagga Basin Server cap. Maximum concurrent players in Hagga Basin. Set very high to disable.",
                    default_value="1000000",
                    options=[
                        {"value": "40", "label": "40 (match PlayerHardCap)"},
                        {"value": "80", "label": "80"},
                        {"value": "200", "label": "200"},
                        {"value": "1000000", "label": "1,000,000 (unlimited)"},
                    ],
                ),
                "AllowGroupTravel": ConfigField(
                    key="AllowGroupTravel",
                    type="bool",
                    description="Allow groups to travel together between maps. When disabled, each player transitions individually.",
                    default_value="false",
                ),
                "NpeGrantDurationInMinutes": ConfigField(
                    key="NpeGrantDurationInMinutes",
                    type="int",
                    description="Duration in minutes that new player experience (NPE) protections last after character creation.",
                    default_value="90",
                    min_value="0",
                    max_value="180",
                    options=[
                        {"value": "0", "label": "0 (disabled)"},
                        {"value": "30", "label": "30 minutes"},
                        {"value": "60", "label": "1 hour"},
                        {"value": "90", "label": "90 minutes (default)"},
                        {"value": "120", "label": "2 hours"},
                        {"value": "180", "label": "3 hours"},
                    ],
                ),
                "MinServers": ConfigField(
                    key="MinServers",
                    type="int",
                    description="Minimum number of server instances to keep running even when empty.",
                    default_value="0",
                    min_value="0",
                    max_value="3",
                    options=[
                        {"value": "0", "label": "0 (spin up on demand)"},
                        {"value": "1", "label": "1 (always one ready)"},
                        {"value": "2", "label": "2"},
                        {"value": "3", "label": "3"},
                    ],
                ),
                "NumExtraServers": ConfigField(
                    key="NumExtraServers",
                    type="int",
                    description="Extra server instances to pre-provision above the active player demand.",
                    default_value="0",
                    min_value="0",
                    max_value="3",
                    options=[
                        {"value": "0", "label": "0 (no extra)"},
                        {"value": "1", "label": "1 extra"},
                        {"value": "2", "label": "2 extra"},
                        {"value": "3", "label": "3 extra"},
                    ],
                ),
                "QueueFailMap": ConfigField(
                    key="QueueFailMap",
                    type="string",
                    description="Map to redirect players to when the queue for this map fails or times out.",
                    default_value="Overmap",
                    options=[
                        {"value": "Overmap", "label": "Overmap (hub)"},
                        {"value": "Survival_1", "label": "Survival (Hagga Basin)"},
                        {"value": "DeepDesert_1", "label": "Deep Desert"},
                    ],
                ),
                "DefaultScheme": ConfigField(
                    key="DefaultScheme",
                    type="string",
                    description="Default authentication scheme. BackendLogin is standard for self-hosted servers.",
                    default_value="BackendLogin",
                    options=[
                        {"value": "BackendLogin", "label": "Backend Login (self-hosted)"},
                    ],
                ),
                "DefaultAuthenticateScheme": ConfigField(
                    key="DefaultAuthenticateScheme",
                    type="string",
                    description="Authentication scheme used when verifying player identity.",
                    default_value="BackendLogin",
                    options=[
                        {"value": "BackendLogin", "label": "Backend Login (self-hosted)"},
                    ],
                ),
                "DefaultChallengeScheme": ConfigField(
                    key="DefaultChallengeScheme",
                    type="string",
                    description="Challenge scheme used when authentication is required.",
                    default_value="BackendLogin",
                    options=[
                        {"value": "BackendLogin", "label": "Backend Login (self-hosted)"},
                    ],
                ),
                "AuthenticationScheme": ConfigField(
                    key="AuthenticationScheme",
                    type="string",
                    description="Primary authentication scheme for the battlegroup.",
                    default_value="BackendLogin",
                    options=[
                        {"value": "BackendLogin", "label": "Backend Login (self-hosted)"},
                    ],
                ),
                "RequireAuthenticatedSignIn": ConfigField(
                    key="RequireAuthenticatedSignIn",
                    type="bool",
                    description="Require full authentication before allowing sign-in. Disable for development/testing only.",
                    default_value="false",
                ),
                "LogLevel": ConfigField(
                    key="LogLevel",
                    type="string",
                    description="Director logging verbosity.",
                    default_value="INFO",
                    options=[
                        {"value": "TRACE", "label": "Trace (very verbose)"},
                        {"value": "DEBUG", "label": "Debug"},
                        {"value": "INFO", "label": "Info (default)"},
                        {"value": "WARNING", "label": "Warning"},
                        {"value": "ERROR", "label": "Error (quiet)"},
                    ],
                ),
            },
            "gateway.ini": {
                "Provider": ConfigField(
                    key="Provider",
                    type="string",
                    description="Provider name shown in server info. Identifies your server in the browser as self-hosted.",
                    default_value="self-hosted",
                ),
                "ListenPort": ConfigField(
                    key="ListenPort",
                    type="int",
                    description="Gateway listener port for incoming client connections.",
                    default_value="7777",
                ),
            },
        }
        # Human-readable file descriptions
        self.file_descriptions: dict[str, dict[str, str]] = {
            "UserGame.ini": {
                "title": "Game Rules & Tweaks",
                "subtitle": "PvP, worms, enemies, loot, weather, and survival",
                "description": "Controls core gameplay: PvP rules, sandworm behavior, NPC difficulty, loot drops, day/night cycle, crafting costs, hydration, and land claims. These settings apply to all maps in the battlegroup.",
            },
            "UserEngine.ini": {
                "title": "Engine & Game Tweaks",
                "subtitle": "Network, mining rates, worms, and vehicle durability",
                "description": "Engine-level settings including network performance, resource gathering multipliers, sandworm controls, and vehicle durability. These console variables apply server-wide.",
            },
            "director.ini": {
                "title": "Battlegroup Director",
                "subtitle": "Maps, player caps, instancing, and authentication",
                "description": "Configures the director that orchestrates the battlegroup. Controls how maps are instanced, player limits per map, authentication, and FLS reporting.",
            },
            "gateway.ini": {
                "title": "Gateway",
                "subtitle": "Server identity and connection endpoint",
                "description": "Gateway configuration for how the server identifies itself and accepts client connections. ServerName and DatacenterId are injected at container startup.",
            },
        }
        self._baseline_hashes: dict[str, str] = {}
        self._drift_status: dict[str, dict] = {}

    async def list_configs(self) -> list[str]:
        return await asyncio.to_thread(self.list_configs_sync)

    def list_configs_sync(self) -> list[str]:
        if not self.config_dir.exists():
            return []
        files = sorted(path.name for path in self.config_dir.iterdir() if path.is_file())
        return [name for name in files if name in self.allowed_files]

    def _compute_hash(self, filepath: Path) -> str:
        """Compute SHA256 hash of a config file."""
        if not filepath.exists():
            return ""
        return hashlib.sha256(filepath.read_bytes()).hexdigest()[:16]

    def snapshot_baseline(self, filename: str) -> None:
        """Record the current file hash as the baseline."""
        self._validate_filename(filename)
        filepath = self.config_dir / filename
        current_hash = self._compute_hash(filepath)
        self._baseline_hashes[filename] = current_hash
        self._drift_status[filename] = {
            "drifted": False,
            "baselineHash": current_hash,
            "currentHash": current_hash,
            "detectedAt": None,
        }

    def check_drift(self, filename: str) -> dict:
        """Check if a config file has drifted from its baseline."""
        self._validate_filename(filename)
        filepath = self.config_dir / filename
        current_hash = self._compute_hash(filepath)
        baseline_hash = self._baseline_hashes.get(filename, "")

        if not baseline_hash:
            self.snapshot_baseline(filename)
            return self._drift_status[filename]

        drifted = current_hash != baseline_hash
        self._drift_status[filename] = {
            "drifted": drifted,
            "baselineHash": baseline_hash,
            "currentHash": current_hash,
            "detectedAt": datetime.now(timezone.utc).isoformat() if drifted else None,
        }
        return self._drift_status[filename]

    def check_all_drift(self) -> dict[str, dict]:
        """Check drift for all known config files."""
        return {filename: self.check_drift(filename) for filename in self.list_configs_sync()}

    def reset_baseline(self, filename: str) -> None:
        """Accept current state as the new baseline."""
        self.snapshot_baseline(filename)

    async def read_config(self, filename: str) -> ConfigFile:
        path = self._resolve_file(filename)
        parser = await asyncio.to_thread(self._load_parser, path)
        sections: dict[str, dict[str, str]] = {
            section: {key: value for key, value in parser.items(section)}
            for section in parser.sections()
        }
        return ConfigFile(filename=filename, sections=sections)

    async def update_config(
        self,
        filename: str,
        update: ConfigUpdate,
        session: AsyncSession,
    ) -> ConfigFile:
        if update.filename != filename:
            raise ValueError("Filename in request body must match route filename.")

        path = self._resolve_file(filename)
        parser = await asyncio.to_thread(self._load_parser, path)
        if not parser.has_section(update.section):
            parser.add_section(update.section)

        normalized_value = self._validate_value(filename, update.key, update.value)
        current = await self.read_config(filename)
        session.add(
            ConfigBackup(
                filename=filename,
                config_type=Path(filename).stem,
                content=current.model_dump()["sections"],
            )
        )
        await session.commit()

        parser.set(update.section, update.key, normalized_value)
        await asyncio.to_thread(self._write_parser, path, parser)
        logger.info("Updated config %s [%s] %s", filename, update.section, update.key)
        return await self.read_config(filename)

    def get_field_definitions(self, filename: str) -> dict[str, ConfigField]:
        return self.field_definitions.get(filename, {})

    def _validate_filename(self, filename: str) -> None:
        if filename not in self.allowed_files:
            raise FileNotFoundError(f"Unsupported config file: {filename}")

    def _resolve_file(self, filename: str) -> Path:
        self._validate_filename(filename)
        path = self.config_dir / filename
        if not path.exists():
            raise FileNotFoundError(f"Config file not found: {filename}")
        resolved_path = path.resolve()
        try:
            resolved_path.relative_to(self.config_dir.resolve())
        except ValueError as exc:
            raise FileNotFoundError(f"Config file not found: {filename}") from exc
        return resolved_path

    def _load_parser(self, path: Path) -> configparser.ConfigParser:
        parser = configparser.ConfigParser()
        parser.optionxform = str
        parser.read(path, encoding="utf-8")
        return parser

    def _write_parser(self, path: Path, parser: configparser.ConfigParser) -> None:
        with tempfile.NamedTemporaryFile(
            mode="w",
            dir=os.path.dirname(path),
            delete=False,
            suffix=".tmp",
            encoding="utf-8",
        ) as tmp:
            parser.write(tmp)
            tmp.flush()
            os.fsync(tmp.fileno())
        os.replace(tmp.name, path)

    def _validate_value(self, filename: str, key: str, value: str) -> str:
        definition = self.get_field_definitions(filename).get(key)
        if not definition:
            return value

        raw_value = str(value).strip()
        allowed_values = {option["value"] for option in definition.options or []}
        is_default_value = definition.default_value is not None and self._config_values_equal(raw_value, definition.default_value)
        is_allowed_value = raw_value in allowed_values or any(self._config_values_equal(raw_value, allowed) for allowed in allowed_values)
        if allowed_values and not is_allowed_value and not is_default_value:
            raise ValueError(f"Invalid value for {key}: expected one of {', '.join(sorted(allowed_values))}.")

        try:
            if definition.type == "bool":
                normalized = raw_value.lower()
                if normalized not in {"1", "0", "true", "false", "yes", "no", "on", "off"}:
                    raise ValueError("Expected a boolean value.")
                return "True" if normalized in {"1", "true", "yes", "on"} else "False"
            if definition.type == "int":
                parsed = int(raw_value)
                if not is_default_value:
                    self._validate_numeric_bounds(parsed, definition.min_value, definition.max_value)
                return str(parsed)
            if definition.type == "float":
                parsed = float(raw_value)
                if not is_default_value:
                    self._validate_numeric_bounds(parsed, definition.min_value, definition.max_value)
                return str(parsed)
            return raw_value
        except ValueError as exc:
            raise ValueError(f"Invalid value for {key}: {exc}") from exc

    def _validate_numeric_bounds(self, value: int | float, min_value: str | None, max_value: str | None) -> None:
        if min_value is not None and value < float(min_value):
            raise ValueError(f"must be at least {min_value}.")
        if max_value is not None and value > float(max_value):
            raise ValueError(f"must be at most {max_value}.")

    def _config_values_equal(self, first: str, second: str) -> bool:
        first_value = first.strip()
        second_value = second.strip()
        if first_value == second_value:
            return True
        if first_value.lower() in {"true", "false"} or second_value.lower() in {"true", "false"}:
            return first_value.lower() == second_value.lower()
        try:
            return float(first_value) == float(second_value)
        except ValueError:
            return False
