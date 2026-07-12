from __future__ import annotations

from typing import Any, Optional

import asyncio
import logging
import os
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import SessionLocal, get_session
from db.models import AuditLog, DashboardSetting
from models.config import ConfigUpdate
from services.backup_service import BackupService
from services.config_service import ConfigService
from services.env_file import read_env_var, write_env_var

logger = logging.getLogger(__name__)


async def _write_audit(session: AsyncSession, action: str, details: dict, request: Request) -> None:
    session.add(AuditLog(
        action=action,
        details=details,
        performed_by=request.headers.get("X-Admin-User", "dashboard"),
    ))

router = APIRouter(tags=["config"])

# ── Pydantic request models ─────────────────────────────────────


class ServerPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    password: str | None = None


class ServerIdentityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worldName: str | None = None
    externalAddress: str | None = None


class ConfigBulkUpdateRequest(BaseModel):
    """Flat mapping of `section.key` to new value strings.

    Extra keys are allowed because config field names are dynamic.
    """
    model_config = ConfigDict(extra="allow")



# Human-friendly labels for Unreal-style keys
_LABEL_OVERRIDES: dict[str, str] = {
    "m_bShouldForceEnablePvpOnAllPartitions": "Force PvP on All Partitions",
    "m_bAreSecurityZonesEnabled": "Security Zones Enabled",
    "m_bCoriolisAutoSpawnEnabled": "Auto-Spawn Coriolis Storms",
    "m_bAutoSpawnEnabled": "Auto-Spawn Sandstorms",
    "m_bMitigateAllSandstormDamage": "Mitigate Sandstorm Damage",
    "m_DefaultReconnectGracePeriodSeconds": "Reconnect Grace Period (seconds)",
    "m_MaxNumLandclaimSegments": "Max Land Claim Segments",
    "m_BaseBackupToolTimeRestrictionInSeconds": "Base Backup Cooldown (seconds)",
    "m_BaseBackupMaxExtensions": "Base Backup Max Extensions",
    "m_BuildingBlueprintMaxExtensions": "Blueprint Max Extensions",
    "m_bBuildingRestrictionLimitsEnabled": "Building Restriction Limits Enabled",
    "m_VehicleQuicksandDamage": "Vehicle Quicksand Damage",
    "m_MaxGuildMembersAllowed": "Max Guild Members",
    "m_MaxGuildsAllowed": "Max Guilds Per Player",
    "m_GuildCreationCost": "Guild Creation Cost",
    "m_MaxPermissionsPerActor": "Max Permissions Per Actor",
    "m_bIsDbWipeEnabled": "Coriolis DB Wipe Enabled",
    "m_DayLengthMinutes": "Day Length (minutes)",
    "m_bHydrationEnabled": "Hydration Enabled",
    "m_bShouldPlayersDropLootOnDeath": "Players Drop Loot On Death",
    "m_bShouldPlayersLoseItemsOnDeath": "Players Lose Items On Death",
    "m_bShouldNpcDropLootOnDeath": "NPCs Drop Loot On Death",
    "m_RepairCostWeight": "Repair Cost Weight",
    "m_RecyclerOutputWeight": "Recycler Output Weight",
    "m_bGiantWormSystemEnabled": "Giant Worm System Enabled",
    "m_EnableSandwormSystem": "Sandworm System Mode",
    "m_GiantWormMinimumPlayersOnSpiceField": "Minimum Spice Field Players for Worm",
    "m_GiantWormSpawningCooldown": "Giant Worm Spawn Cooldown",
    "m_MinDistanceBetweenSandworms": "Min Distance Between Sandworms",
    "m_ThreatDecayPerSecond": "Threat Decay Per Second",
    "m_MaxReinforcementSize": "Max Reinforcement Size",
    "PlayerInventoryStartingSize": "Starting Inventory Size",
    "PlayerInventoryStartingVolumeCapacity": "Starting Inventory Volume Capacity",
    "UpdateRateInSeconds": "Item Deterioration Update Rate",
    "SellOrderPricePercentageFee": "Exchange Sell Order Fee",
    "m_MinimumAugmentableItemQuality": "Minimum Augmentable Item Quality",
    "NetServerMaxTickRate": "Network Tick Rate",
    "MaxClientRate": "Max Client Rate (bytes/sec)",
    "MaxInternetClientRate": "Max Internet Client Rate (bytes/sec)",
    "ShouldUpdatePlayerCountOnFls": "Report Player Count to FLS",
    "PlayerHardCap": "Player Hard Cap",
    "ForceLock": "Force Lock Server",
    "DauCap": "Daily Active User Cap",
    "WauCap": "Weekly Active User Cap",
    "HbsCap": "Hagga Basin Server Cap",
    "AllowGroupTravel": "Allow Group Travel",
    "NpeGrantDurationInMinutes": "New Player Protection (minutes)",
    "MinServers": "Minimum Server Instances",
    "NumExtraServers": "Extra Pre-Provisioned Servers",
    "QueueFailMap": "Queue Fail Redirect Map",
    "AuthorizationPreset": "Authorization Preset",
    "DefaultScheme": "Default Auth Scheme",
    "DefaultAuthenticateScheme": "Default Authenticate Scheme",
    "DefaultChallengeScheme": "Default Challenge Scheme",
    "AuthenticationScheme": "Authentication Scheme",
    "RequireAuthenticatedSignIn": "Require Authenticated Sign-In",
    "IGWPort": "IGW Port",
    "LogLevel": "Log Level",
    "Overmap": "Overmap Mode",
    "Survival_1": "Survival (Hagga Basin) Mode",
    "DeepDesert_1": "Deep Desert Mode",
    "Provider": "Provider Name",
    "ListenPort": "Listen Port",
    "Port": "Game Server Port",
    "+Dune.GlobalMiningOutputMultiplier": "Hand Mining Output Multiplier",
    "+Dune.GlobalVehicleMiningOutputMultiplier": "Vehicle Mining Output Multiplier",
    "+SecurityZones.PvpResourceMultiplier": "PvP Zone Resource Multiplier",
    "+dw.VehicleDurabilityDamageMultiplier": "Vehicle Durability Damage Multiplier",
    "+sandworm.dune.Enabled": "Sandworm Console Toggle",
    "+Vehicle.SandwormCollisionInteraction": "Vehicle Sandworm Collision",
    "+Sandstorm.Enabled": "Sandstorms Enabled",
    "+Sandstorm.Treasure.Enabled": "Sandstorm Treasure Enabled",
    "+Sandworm.SandwormDangerZonesEnabled": "Sandworm Danger Zones Enabled",
    "Dune.GlobalMiningOutputMultiplier": "Hand Mining Output Multiplier",
    "Dune.GlobalVehicleMiningOutputMultiplier": "Vehicle Mining Output Multiplier",
    "SecurityZones.PvpResourceMultiplier": "PvP Zone Resource Multiplier",
    "dw.VehicleDurabilityDamageMultiplier": "Vehicle Durability Damage Multiplier",
    "sandworm.dune.Enabled": "Sandworm Console Toggle",
    "Vehicle.SandwormCollisionInteraction": "Vehicle Sandworm Collision",
}


def _pascal_to_label(key: str) -> str:
    """Convert PascalCase / camelCase to 'Pascal Case'."""
    if key in _LABEL_OVERRIDES:
        return _LABEL_OVERRIDES[key]
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", key)
    spaced = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", spaced)
    return spaced.replace("_", " ").strip()


def _config_to_frontend(config, definitions: dict | None = None) -> dict:
    """Convert backend ConfigFile (sections dict) to frontend expected shape."""
    definitions = definitions or {}
    fields = []
    sections = getattr(config, "sections", {}) or {}
    for section_name, keys in sections.items():
        for key, value in keys.items():
            defn = definitions.get(key)
            field_type = "string"
            parsed_value: str | int | float | bool = value
            low = value.lower() if isinstance(value, str) else ""
            if low in ("true", "false"):
                field_type = "boolean"
                parsed_value = low == "true"
            elif value.replace(".", "", 1).replace("-", "", 1).isdigit():
                field_type = "number"
                parsed_value = float(value) if "." in value else int(value)

            label = _pascal_to_label(key)
            description = defn.description if defn else ""
            default_value = defn.default_value if defn else None
            min_value = defn.min_value if defn else None
            max_value = defn.max_value if defn else None
            options = defn.options if defn and defn.options else None

            # If definition has options, render as select dropdown
            if options:
                field_type = "select"

            fields.append({
                "key": key,
                "label": label,
                "section": section_name,
                "type": field_type,
                "value": parsed_value,
                "description": description,
                "defaultValue": default_value,
                "minValue": min_value,
                "maxValue": max_value,
                "options": options,
            })
    filename = getattr(config, "filename", "")
    title = filename.replace(".ini", "").replace("User", "").replace("_", " ").title() or filename
    return {
        "filename": filename,
        "title": title,
        "description": f"Configuration from {filename}",
        "fields": fields,
    }


@router.get("/config")
async def list_configs(request: Request) -> dict[str, object]:
    service: ConfigService = request.app.state.config_service
    files = await service.list_configs()
    return {
        "files": files,
        "definitions": {name: defs for name, defs in ((file, service.get_field_definitions(file)) for file in files)},
        "fileDescriptions": getattr(service, "file_descriptions", {}),
    }


@router.get("/config/drift")
async def get_drift_status(request: Request) -> dict:
    """Get drift status for all config files."""
    service: ConfigService = request.app.state.config_service
    drift = await asyncio.to_thread(service.check_all_drift)
    return {"files": drift}


@router.post("/config/{filename}/accept-drift")
async def accept_drift(filename: str, request: Request) -> dict:
    """Accept current config as new baseline."""
    try:
        service: ConfigService = request.app.state.config_service
        await asyncio.to_thread(service.reset_baseline, filename)
        return {"status": "ok", "filename": filename}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/config/{filename}")
async def get_config(filename: str, request: Request) -> dict:
    try:
        service: ConfigService = request.app.state.config_service
        config = await service.read_config(filename)
        definitions = service.get_field_definitions(filename)
        result = _config_to_frontend(config, definitions)
        result["drift"] = await asyncio.to_thread(service.check_drift, filename)
        file_desc = getattr(service, "file_descriptions", {}).get(filename, {})
        if file_desc:
            result["title"] = file_desc.get("title", result["title"])
            result["subtitle"] = file_desc.get("subtitle", "")
            result["description"] = file_desc.get("description", result["description"])
        return result
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/config/{filename}")
async def update_config(
    filename: str,
    payload: ConfigBulkUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        # Frontend sends { "section.key": value } - convert to ConfigUpdate calls
        service: ConfigService = request.app.state.config_service
        backup_service: BackupService = request.app.state.backup_service
        try:
            await backup_service.create_backup(scope="configs")
        except Exception as exc:
            logger.warning("Pre-save config backup failed for %s: %s", filename, exc)
        current_config = await service.read_config(filename)
        compound_to_field = {
            f"{section}.{key}": (section, key)
            for section, keys in current_config.sections.items()
            for key in keys
        }
        changes = payload.model_dump()
        for compound_key, value in changes.items():
            field = compound_to_field.get(compound_key)
            if not field:
                logger.warning("Ignoring unknown config field %s in %s", compound_key, filename)
                continue
            section, key = field
            update = ConfigUpdate(filename=filename, section=section, key=key, value=str(value))
            await service.update_config(filename, update, session)
        await _write_audit(session, "config_update", {
            "filename": filename,
            "changes": {k: v for k, v in changes.items() if "." in k},
        }, request)
        await session.commit()
        config = await service.read_config(filename)
        return _config_to_frontend(config, service.get_field_definitions(filename))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Server password toggle
# ---------------------------------------------------------------------------

_ENV_PATH = os.getenv("DUNE_ENV_FILE", "/workspace/.env")
_PASSWORD_KEY = "DUNE_SERVER_LOGIN_PASSWORD"
_STORED_PASSWORD_SETTING = "server_password_stored"
_env_lock = asyncio.Lock()

# Game-server container name patterns — matched with containslogic
_GAME_CONTAINERS = (
    "survival_1", "overmap", "deep_desert_1", "arrakeen", "harko_village",
    "proces_verbal", "testing_carthag", "testing_hephaestus", "testing_waterfat",
)


def _read_env_password() -> tuple[bool, str]:
    """Return (enabled, stored_value) from the .env file."""
    try:
        with open(_ENV_PATH, encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\n")
                if line.startswith(f"{_PASSWORD_KEY}="):
                    value = line[len(_PASSWORD_KEY) + 1:].strip('"').strip("'").strip()
                    return bool(value), value
    except FileNotFoundError:
        pass
    return False, ""


def _write_env_password(value: str) -> None:
    """Rewrite the DUNE_SERVER_LOGIN_PASSWORD line in .env."""
    try:
        with open(_ENV_PATH, encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        content = ""

    pattern = rf'^{re.escape(_PASSWORD_KEY)}=.*$'
    new_line = f'{_PASSWORD_KEY}={value}'
    if re.search(pattern, content, re.MULTILINE):
        content = re.sub(pattern, new_line, content, flags=re.MULTILINE)
    else:
        content = content.rstrip("\n") + f"\n{new_line}\n"

    with open(_ENV_PATH, "w", encoding="utf-8") as f:
        f.write(content)


async def _restart_game_servers(request: Request) -> list[str]:
    """Recreate game containers via docker compose so they pick up the new .env."""
    import subprocess
    import shutil

    compose_dir = "/workspace/compose"
    profile = os.getenv("DEPLOYMENT_PROFILE", os.getenv("DUNE_COMPOSE_OVERLAY", "basic"))
    profile_file = str(Path(compose_dir) / f"docker-compose.{profile}.yml")
    base_file = str(Path(compose_dir) / "docker-compose.yml")

    # If profile file doesn't exist fall back to basic
    if not Path(profile_file).exists():
        profile_file = str(Path(compose_dir) / "docker-compose.basic.yml")

    # Build compose file list
    compose_files = [base_file, profile_file]

    # Include host networking overlay if configured
    hostnet = os.getenv("DUNE_HOSTNET_OVERLAY", "")
    if hostnet:
        hostnet_path = str(Path(compose_dir) / hostnet)
        if Path(hostnet_path).exists():
            compose_files.append(hostnet_path)

    docker_bin = shutil.which("docker")
    if docker_bin is None or not Path(base_file).exists():
        logger.warning("docker binary or compose files not found; falling back to SDK restart")
        return await _sdk_restart_game_servers(request)

    # Exclude disabled services (e.g. deep_desert_1 paused to save RAM)
    disabled_raw = os.getenv("DUNE_DISABLED_SERVICES", "")
    disabled_set = {s.strip() for s in disabled_raw.split(",") if s.strip()}
    active_containers = [c for c in _GAME_CONTAINERS if c not in disabled_set]

    cmd = [docker_bin, "compose"]
    for f in compose_files:
        cmd.extend(["-f", f])
    cmd.extend(["--env-file", _ENV_PATH, "up", "-d", "--force-recreate", "--no-deps"])
    cmd.extend(active_containers)

    logger.info("Recreating game servers: %s", " ".join(cmd))
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=120)
        output = stdout.decode(errors="replace").strip() if stdout else ""
        if proc.returncode != 0:
            logger.warning("docker compose up returned %s: %s", proc.returncode, output)
            return []
        logger.info("docker compose up output: %s", output)
        return ["dune-awakening-survival_1-1", "dune-awakening-overmap-1"]
    except asyncio.TimeoutError:
        logger.error("docker compose up timed out")
        return []
    except Exception as exc:
        logger.error("Failed to recreate game servers: %s", exc)
        return []


async def _sdk_restart_game_servers(request: Request) -> list[str]:
    """Fallback: restart (not recreate) via SDK. Does not pick up .env changes."""
    docker_service = request.app.state.docker_service
    restarted: list[str] = []
    try:
        containers = await docker_service.list_containers()
        for svc in containers:
            if any(pat in svc.name.lower() for pat in _GAME_CONTAINERS):
                try:
                    await docker_service.restart_container(svc.name)
                    restarted.append(svc.name)
                except Exception as exc:
                    logger.warning("Could not restart %s: %s", svc.name, exc)
    except Exception as exc:
        logger.warning("Could not list containers for restart: %s", exc)
    return restarted


async def _get_stored_password() -> str:
    async with SessionLocal() as session:
        row = await session.get(DashboardSetting, _STORED_PASSWORD_SETTING)
        if row and isinstance(row.value, dict):
            return row.value.get("password", "")
        return ""


async def _set_stored_password(password: str) -> None:
    from datetime import datetime, timezone
    async with SessionLocal() as session:
        row = await session.get(DashboardSetting, _STORED_PASSWORD_SETTING)
        if row:
            row.value = {"password": password}
            row.updated_at = datetime.now(timezone.utc)
        else:
            row = DashboardSetting(
                key=_STORED_PASSWORD_SETTING,
                value={"password": password},
            )
            session.add(row)
        await session.commit()


@router.get("/server/password")
async def get_server_password() -> dict:
    """Return whether a login password is currently active."""
    enabled, _ = _read_env_password()
    stored = await _get_stored_password()
    return {"enabled": enabled, "hasPassword": bool(stored)}


@router.put("/server/password")
async def set_server_password(
    payload: ServerPasswordRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Enable or disable the server login password.

    Body: ``{"enabled": true|false, "password": "..."}``
    Persists the password value in the dashboard DB so it can be re-enabled later.
    Writes the .env file and restarts the game-server containers.
    """
    enabled: bool = payload.enabled
    new_password: str | None = payload.password

    async with _env_lock:
        _, current = _read_env_password()
        stored = await _get_stored_password() or current

        if new_password is not None:
            stored = new_password

        if stored:
            await _set_stored_password(stored)

        write_value = stored if enabled else ""
        await asyncio.to_thread(_write_env_password, write_value)

    restarted = await _restart_game_servers(request)

    session.add(AuditLog(
        action="server_password_toggle",
        details={"enabled": enabled, "containersRestarted": restarted},
        performed_by=request.headers.get("X-Admin-User", "dashboard"),
    ))
    await session.commit()

    logger.info("Server password %s; restarted: %s", "enabled" if enabled else "disabled", restarted)
    return {"enabled": enabled, "restarted": restarted, "status": "ok"}


# ---------------------------------------------------------------------------
# Server identity (world name + broadcast address)
# ---------------------------------------------------------------------------

_WORLD_NAME_KEY = "WORLD_NAME"
_EXTERNAL_ADDRESS_KEY = "EXTERNAL_ADDRESS"
_WORLD_NAME_MAX = 64
_INVALID_WORLD_NAME_CHARS = ("'", "|", '"')
_EXTERNAL_ADDRESS_RE = re.compile(r"^[A-Za-z0-9.\-]+$")


def _validate_world_name(name: str) -> str:
    name = name.strip()
    if not name:
        raise ValueError("Server name cannot be empty.")
    if len(name) > _WORLD_NAME_MAX:
        raise ValueError(f"Server name must be at most {_WORLD_NAME_MAX} characters.")
    if any(ch in name for ch in _INVALID_WORLD_NAME_CHARS):
        raise ValueError("Server name cannot contain quotes, apostrophes, or the | character.")
    if any(ord(ch) < 32 for ch in name):
        raise ValueError("Server name cannot contain control characters.")
    return name


def _validate_external_address(addr: str) -> str:
    addr = addr.strip()
    if not addr:
        raise ValueError("Broadcast address cannot be empty (use 'auto' for automatic detection).")
    if len(addr) > 255:
        raise ValueError("Broadcast address is too long.")
    if addr.lower() == "auto":
        return "auto"
    if not _EXTERNAL_ADDRESS_RE.match(addr):
        raise ValueError("Broadcast address must be 'auto', an IP address, or a hostname.")
    return addr


@router.get("/server/identity")
async def get_server_identity() -> dict:
    """Return the effective in-game server name and broadcast address from .env."""
    world_name = read_env_var(_WORLD_NAME_KEY) or os.getenv(_WORLD_NAME_KEY, "My Dune Awakening Server")
    external = read_env_var(_EXTERNAL_ADDRESS_KEY) or os.getenv(_EXTERNAL_ADDRESS_KEY, "auto")
    return {"worldName": world_name, "externalAddress": external}


@router.put("/server/identity")
async def set_server_identity(
    payload: ServerIdentityRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Update the in-game server name (``WORLD_NAME``) and/or broadcast address
    (``EXTERNAL_ADDRESS``).

    Body: ``{"worldName": "...", "externalAddress": "auto"}`` (both optional).
    Writes the .env file and recreates the game-server containers so the new
    values take effect, mirroring the server-password flow.
    """
    raw_world = payload.worldName
    raw_external = payload.externalAddress

    changes: dict[str, str] = {}
    try:
        if raw_world is not None:
            changes[_WORLD_NAME_KEY] = _validate_world_name(str(raw_world))
        if raw_external is not None:
            changes[_EXTERNAL_ADDRESS_KEY] = _validate_external_address(str(raw_external))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not changes:
        raise HTTPException(status_code=400, detail="No server identity changes provided.")

    async with _env_lock:
        if _WORLD_NAME_KEY in changes:
            await asyncio.to_thread(write_env_var, _WORLD_NAME_KEY, changes[_WORLD_NAME_KEY], quote=True)
        if _EXTERNAL_ADDRESS_KEY in changes:
            await asyncio.to_thread(write_env_var, _EXTERNAL_ADDRESS_KEY, changes[_EXTERNAL_ADDRESS_KEY])

    restarted = await _restart_game_servers(request)

    session.add(AuditLog(
        action="server_identity_update",
        details={"changed": list(changes.keys()), "containersRestarted": restarted},
        performed_by=request.headers.get("X-Admin-User", "dashboard"),
    ))
    await session.commit()

    logger.info("Server identity updated (%s); restarted: %s", ", ".join(changes), restarted)
    return {
        "worldName": changes.get(_WORLD_NAME_KEY),
        "externalAddress": changes.get(_EXTERNAL_ADDRESS_KEY),
        "restarted": restarted,
        "status": "ok",
    }
