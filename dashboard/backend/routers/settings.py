from __future__ import annotations

import os

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from db.database import SessionLocal
from db.models import AdminUser, DashboardSetting

router = APIRouter(tags=["settings"])

_world_name = os.getenv("WORLD_NAME") or os.getenv("DUNE_WORLD_NAME", "Dune Awakening Server")



# ── Pydantic request models ─────────────────────────────────────


class SettingsImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    settings: dict[str, dict[str, Any]]
    version: int | None = None
    exportedAt: str | None = None


class AddAdminRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1)
    role: str = "admin"


class UpdateAdminRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: str | None = None
    enabled: bool | None = None


class SteamAccountSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = ""
    password: str = ""


DEFAULTS: dict[str, dict] = {
    "general": {
        "serverName": _world_name,
        "serverDescription": "Self-hosted Dune Awakening server fleet",
        "motd": "",
        "timezone": "UTC",
    },
    "security": {
        "sessionTimeoutMinutes": 60,
        "mfaEnabled": False,
        "ipAllowlist": [],
    },
    "integrations": {
        "grafanaUrl": "",
        "prometheusUrl": "",
        "uptimeKumaUrl": "",
        "uptimeKumaPushToken": "",
        "externalWebhooks": [],
    },
    "appearance": {
        "accentColor": "amber",
        "compactMode": False,
        "showPublicStatus": True,
    },
}


async def _get_setting(key: str) -> dict:
    async with SessionLocal() as session:
        row = await session.get(DashboardSetting, key)
        if row and row.value is not None:
            merged = {**DEFAULTS.get(key, {}), **row.value}
            return merged
        return dict(DEFAULTS.get(key, {}))


async def _put_setting(key: str, value: dict) -> dict:
    async with SessionLocal() as session:
        row = await session.get(DashboardSetting, key)
        if row:
            row.value = value
            row.updated_at = datetime.now(timezone.utc)
        else:
            row = DashboardSetting(key=key, value=value, updated_at=datetime.now(timezone.utc))
            session.add(row)
        await session.commit()
        return value


# ── General settings ──────────────────────────────────────────────

@router.get("/settings")
async def get_all_settings() -> dict:
    result = {}
    for key in DEFAULTS:
        result[key] = await _get_setting(key)
    return result


# ── Import / Export (must come before {section} catch-all) ────────

@router.get("/settings/export/all")
async def export_settings() -> dict:
    result = {}
    for key in DEFAULTS:
        result[key] = await _get_setting(key)
    return {"version": 1, "exportedAt": datetime.now(timezone.utc).isoformat(), "settings": result}


@router.post("/settings/import/all")
async def import_settings(payload: SettingsImportRequest) -> dict:
    settings = payload.settings
    imported = []
    for key, value in settings.items():
        if isinstance(value, dict):
            await _put_setting(key, value)
            imported.append(key)
    return {"status": "ok", "imported": imported}


# ── Admin users (must come before {section} catch-all) ────────────

@router.get("/settings/admins")
async def list_admins() -> list[dict]:
    async with SessionLocal() as session:
        rows = (await session.execute(select(AdminUser).order_by(AdminUser.created_at))).scalars().all()
        return [
            {
                "id": u.id,
                "username": u.username,
                "role": u.role,
                "enabled": u.enabled,
                "createdAt": u.created_at.isoformat() if u.created_at else None,
                "lastLogin": u.last_login.isoformat() if u.last_login else None,
            }
            for u in rows
        ]


@router.post("/settings/admins")
async def add_admin(payload: AddAdminRequest) -> dict:
    username = payload.username.strip()
    role = payload.role
    async with SessionLocal() as session:
        existing = (await session.execute(select(AdminUser).where(AdminUser.username == username))).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail="Username already exists")
        user = AdminUser(username=username, role=role)
        session.add(user)
        await session.commit()
        return {"id": user.id, "username": user.username, "role": user.role, "enabled": user.enabled}


@router.delete("/settings/admins/{admin_id}")
async def remove_admin(admin_id: int) -> dict:
    async with SessionLocal() as session:
        user = await session.get(AdminUser, admin_id)
        if not user:
            raise HTTPException(status_code=404, detail="Admin not found")
        await session.delete(user)
        await session.commit()
        return {"status": "ok", "removed": user.username}


@router.put("/settings/admins/{admin_id}")
async def update_admin(admin_id: int, payload: UpdateAdminRequest) -> dict:
    async with SessionLocal() as session:
        user = await session.get(AdminUser, admin_id)
        if not user:
            raise HTTPException(status_code=404, detail="Admin not found")
        if payload.role is not None:
            user.role = payload.role
        if payload.enabled is not None:
            user.enabled = payload.enabled
        await session.commit()
        return {"id": user.id, "username": user.username, "role": user.role, "enabled": user.enabled}


# ── Steam account settings (must come before {section} catch-all) ─

@router.get("/settings/steam-account")
async def get_steam_account_settings():
    """Get current Steam account configuration (password never exposed)."""
    service = get_update_service()
    return await service.get_steam_account_settings()


@router.put("/settings/steam-account")
async def set_steam_account_settings(payload: SteamAccountSettingsRequest):
    """Save Steam account credentials for authenticated SteamCMD login."""
    if not payload.username.strip():
        raise HTTPException(status_code=400, detail="Username is required")
    if not payload.password.strip():
        raise HTTPException(status_code=400, detail="Password is required")
    service = get_update_service()
    return await service.set_steam_account_settings(payload.username, payload.password)


@router.post("/settings/steam-account/test")
async def test_steam_account_login():
    """Test the configured Steam account by running steamcmd +login +quit."""
    service = get_update_service()
    return await service.test_steam_login()


@router.delete("/settings/steam-account")
async def clear_steam_account_settings():
    """Clear stored Steam credentials, revert to anonymous login."""
    service = get_update_service()
    return await service.clear_steam_account_settings()


# ── Section catch-all (must be last) ─────────────────────────────

@router.get("/settings/{section}")
async def get_setting_section(section: str) -> dict:
    return await _get_setting(section)


@router.put("/settings/{section}")
async def update_setting_section(section: str, body: dict[str, Any]) -> dict:
    saved = await _put_setting(section, body)
    return saved
