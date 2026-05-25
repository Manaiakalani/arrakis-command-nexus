from __future__ import annotations

import asyncio
import configparser
import hashlib
import logging
import os
from datetime import datetime, timezone
from io import StringIO
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
                    default_value="False",
                ),
                "m_DefaultReconnectGracePeriodSeconds": ConfigField(
                    key="m_DefaultReconnectGracePeriodSeconds",
                    type="int",
                    description="Seconds a disconnected player's character stays in-world before despawning. Set to 0 for instant despawn (good for Steam Deck users).",
                    default_value="0",
                ),
                "m_MaxNumLandclaimSegments": ConfigField(
                    key="m_MaxNumLandclaimSegments",
                    type="int",
                    description="Maximum number of land claim segments allowed per map. Controls how much territory players can claim.",
                    default_value="10",
                ),
                "m_BaseBackupToolTimeRestrictionInSeconds": ConfigField(
                    key="m_BaseBackupToolTimeRestrictionInSeconds",
                    type="int",
                    description="Cooldown in seconds before a base backup tool can be used again. Default 604800 = 7 days. Lower values allow more frequent base backups.",
                    default_value="604800",
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
            },
            "UserEngine.ini": {
                "NetServerMaxTickRate": ConfigField(
                    key="NetServerMaxTickRate",
                    type="int",
                    description="Network tick rate for the server engine. Higher values = smoother but more resource-intensive.",
                    default_value="60",
                ),
                "MaxClientRate": ConfigField(
                    key="MaxClientRate",
                    type="int",
                    description="Maximum bytes per second the server will send to a single client.",
                    default_value="100000",
                ),
                "MaxInternetClientRate": ConfigField(
                    key="MaxInternetClientRate",
                    type="int",
                    description="Maximum bytes per second for internet-connected clients. Should match or exceed MaxClientRate.",
                    default_value="100000",
                ),
            },
            "director.ini": {
                "AuthorizationPreset": ConfigField(
                    key="AuthorizationPreset",
                    type="string",
                    description="Authentication preset used by the battlegroup director. BattlegroupInternal is standard for self-hosted servers.",
                    default_value="BattlegroupInternal",
                ),
                "Overmap": ConfigField(
                    key="Overmap",
                    type="string",
                    description="Instancing mode for the Overmap. SingleServer = one shared instance. Dimension = multiple parallel instances.",
                    default_value="SingleServer",
                ),
                "Survival_1": ConfigField(
                    key="Survival_1",
                    type="string",
                    description="Instancing mode for Hagga Basin (Survival). Dimension = players distributed across instances. ClassicalInstancing = dynamic scaling.",
                    default_value="Dimension",
                ),
                "DeepDesert_1": ConfigField(
                    key="DeepDesert_1",
                    type="string",
                    description="Instancing mode for the Deep Desert. ClassicalInstancing = server instances scale dynamically based on player population.",
                    default_value="ClassicalInstancing",
                ),
                "PlayerHardCap": ConfigField(
                    key="PlayerHardCap",
                    type="int",
                    description="Maximum number of players allowed on this server or map partition.",
                    default_value="40",
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
                ),
                "WauCap": ConfigField(
                    key="WauCap",
                    type="int",
                    description="Weekly Active User cap. Maximum unique players per week. Default 3360 is the Funcom standard.",
                    default_value="3360",
                ),
                "HbsCap": ConfigField(
                    key="HbsCap",
                    type="int",
                    description="Hagga Basin Server cap. Maximum concurrent players in Hagga Basin. Set very high to disable.",
                    default_value="1000000",
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
                ),
                "MinServers": ConfigField(
                    key="MinServers",
                    type="int",
                    description="Minimum number of server instances to keep running even when empty.",
                    default_value="0",
                ),
                "NumExtraServers": ConfigField(
                    key="NumExtraServers",
                    type="int",
                    description="Extra server instances to pre-provision above the active player demand.",
                    default_value="0",
                ),
                "QueueFailMap": ConfigField(
                    key="QueueFailMap",
                    type="string",
                    description="Map to redirect players to when the queue for this map fails or times out.",
                    default_value="Overmap",
                ),
                "DefaultScheme": ConfigField(
                    key="DefaultScheme",
                    type="string",
                    description="Default authentication scheme. BackendLogin is standard for self-hosted servers.",
                    default_value="BackendLogin",
                ),
                "DefaultAuthenticateScheme": ConfigField(
                    key="DefaultAuthenticateScheme",
                    type="string",
                    description="Authentication scheme used when verifying player identity.",
                    default_value="BackendLogin",
                ),
                "DefaultChallengeScheme": ConfigField(
                    key="DefaultChallengeScheme",
                    type="string",
                    description="Challenge scheme used when authentication is required.",
                    default_value="BackendLogin",
                ),
                "AuthenticationScheme": ConfigField(
                    key="AuthenticationScheme",
                    type="string",
                    description="Primary authentication scheme for the battlegroup.",
                    default_value="BackendLogin",
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
                    description="Director logging verbosity. Options: TRACE, DEBUG, INFO, WARNING, ERROR.",
                    default_value="INFO",
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
                "title": "Game Rules",
                "subtitle": "Gameplay, PvP, storms, and base building",
                "description": "Controls core gameplay mechanics like PvP rules, security zones, storm spawning, reconnect behavior, and land claims. These settings apply to all maps in the battlegroup.",
            },
            "UserEngine.ini": {
                "title": "Engine Performance",
                "subtitle": "Network tick rate and bandwidth limits",
                "description": "Low-level engine settings for network performance. Adjust tick rate and bandwidth caps to balance smoothness vs. server resource usage.",
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
        buffer = StringIO()
        parser.write(buffer)
        path.write_text(buffer.getvalue(), encoding="utf-8")

    def _validate_value(self, filename: str, key: str, value: str) -> str:
        definition = self.get_field_definitions(filename).get(key)
        if not definition:
            return value

        try:
            if definition.type == "bool":
                normalized = value.strip().lower()
                if normalized not in {"1", "0", "true", "false", "yes", "no", "on", "off"}:
                    raise ValueError("Expected a boolean value.")
                return "True" if normalized in {"1", "true", "yes", "on"} else "False"
            if definition.type == "int":
                return str(int(value))
            if definition.type == "float":
                return str(float(value))
            return str(value)
        except ValueError as exc:
            raise ValueError(f"Invalid value for {key}: {exc}") from exc
