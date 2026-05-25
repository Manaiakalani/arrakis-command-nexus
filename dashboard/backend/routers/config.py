from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from models.config import ConfigUpdate
from services.backup_service import BackupService
from services.config_service import ConfigService

import re

logger = logging.getLogger(__name__)

router = APIRouter(tags=["config"])

# Human-friendly labels for Unreal-style keys
_LABEL_OVERRIDES: dict[str, str] = {
    "m_bShouldForceEnablePvpOnAllPartitions": "Force PvP on All Partitions",
    "m_bAreSecurityZonesEnabled": "Security Zones Enabled",
    "m_bCoriolisAutoSpawnEnabled": "Auto-Spawn Coriolis Storms",
    "m_DefaultReconnectGracePeriodSeconds": "Reconnect Grace Period (seconds)",
    "m_MaxNumLandclaimSegments": "Max Land Claim Segments",
    "m_BaseBackupToolTimeRestrictionInSeconds": "Base Backup Cooldown (seconds)",
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
    payload: dict,
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
        for compound_key, value in payload.items():
            if "." not in compound_key:
                continue
            section, key = compound_key.split(".", 1)
            update = ConfigUpdate(filename=filename, section=section, key=key, value=str(value))
            await service.update_config(filename, update, session)
        config = await service.read_config(filename)
        return _config_to_frontend(config)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
