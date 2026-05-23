from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from sqlalchemy import select

from db.database import SessionLocal
from db.models import AdminUser, DashboardSetting

logger = logging.getLogger(__name__)

router = APIRouter(tags=["settings"])

DEFAULTS: dict[str, dict] = {
    "general": {
        "serverName": "Arrakis Command Nexus",
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
async def import_settings(request: Request) -> dict:
    body = await request.json()
    settings = body.get("settings", {})
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
async def add_admin(request: Request) -> dict:
    body = await request.json()
    username = body.get("username", "").strip()
    role = body.get("role", "admin")
    if not username:
        return {"error": "Username is required"}
    async with SessionLocal() as session:
        existing = (await session.execute(select(AdminUser).where(AdminUser.username == username))).scalar_one_or_none()
        if existing:
            return {"error": "Username already exists"}
        user = AdminUser(username=username, role=role)
        session.add(user)
        await session.commit()
        return {"id": user.id, "username": user.username, "role": user.role, "enabled": user.enabled}


@router.delete("/settings/admins/{admin_id}")
async def remove_admin(admin_id: int) -> dict:
    async with SessionLocal() as session:
        user = await session.get(AdminUser, admin_id)
        if not user:
            return {"error": "Admin not found"}
        await session.delete(user)
        await session.commit()
        return {"status": "ok", "removed": user.username}


@router.put("/settings/admins/{admin_id}")
async def update_admin(admin_id: int, request: Request) -> dict:
    body = await request.json()
    async with SessionLocal() as session:
        user = await session.get(AdminUser, admin_id)
        if not user:
            return {"error": "Admin not found"}
        if "role" in body:
            user.role = body["role"]
        if "enabled" in body:
            user.enabled = body["enabled"]
        await session.commit()
        return {"id": user.id, "username": user.username, "role": user.role, "enabled": user.enabled}


# ── Section catch-all (must be last) ─────────────────────────────

@router.get("/settings/{section}")
async def get_setting_section(section: str) -> dict:
    return await _get_setting(section)


@router.put("/settings/{section}")
async def update_setting_section(section: str, request: Request) -> dict:
    body = await request.json()
    saved = await _put_setting(section, body)
    return saved
