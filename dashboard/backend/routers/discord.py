from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from models.discord import (
    DiscordWebhookCreate,
    DiscordWebhookUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["discord"])

_EVENT_FIELDS = {
    "server-start": "notify_start",
    "server-stop": "notify_stop",
    "server-crash": "notify_crash",
    "player-join": "notify_player_join",
    "player-leave": "notify_player_leave",
    "update-available": "notify_update_available",
    "backup": "notify_backup",
    "scheduled-restart": "notify_scheduled_restart",
    "admin-action": "notify_admin_action",
    "resource-alert": "notify_resource",
}


def _mask_url(url: str) -> str:
    """Mask a Discord webhook URL, keeping only the last 6 chars for identification."""
    if not url or len(url) < 10:
        return "****"
    return f"...{url[-6:]}"


def _webhook_to_frontend(entry, stats: dict | None = None) -> dict:
    """Convert backend DiscordWebhookEntry to frontend expected shape."""
    events = []
    for event_name, field_name in _EVENT_FIELDS.items():
        if getattr(entry, field_name, False):
            events.append(event_name)
    stats = stats or {}
    return {
        "id": str(getattr(entry, "id", "")),
        "name": getattr(entry, "name", None) or f"Webhook #{getattr(entry, 'id', '')}",
        "url": _mask_url(str(getattr(entry, "url", ""))),
        "enabled": getattr(entry, "enabled", True),
        "events": events,
        "isHealthy": stats.get("isHealthy", True),
        "lastTriggeredAt": stats.get("lastTriggeredAt"),
        "recentEvents": stats.get("recentEvents", []),
    }


class FrontendWebhookCreate(BaseModel):
    name: str | None = None
    url: str
    enabled: bool = True
    events: list[str] | None = None
    isHealthy: bool | None = None
    lastTriggeredAt: str | None = None
    recentEvents: list | None = None

    @property
    def validated_url(self) -> str:
        """Validate that the URL is a Discord webhook to prevent SSRF."""
        _ALLOWED_PREFIXES = (
            "https://discord.com/api/webhooks/",
            "https://discordapp.com/api/webhooks/",
        )
        if not self.url.startswith(_ALLOWED_PREFIXES):
            raise ValueError("URL must be a Discord webhook URL (https://discord.com/api/webhooks/...)")
        return self.url


class FrontendWebhookUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    enabled: bool | None = None
    events: list[str] | None = None
    isHealthy: bool | None = None


class FrontendAnnouncement(BaseModel):
    text: str


def _events_to_flags(events: list[str] | None) -> dict:
    """Convert frontend events list to backend notify_* flags."""
    flags = {v: False for v in _EVENT_FIELDS.values()}
    if events:
        for event_name, field_name in _EVENT_FIELDS.items():
            if event_name in events:
                flags[field_name] = True
    return flags


@router.get("/discord/webhooks")
async def list_webhooks(request: Request, session: AsyncSession = Depends(get_session)) -> list[dict]:
    entries = await request.app.state.discord_service.list_webhooks(session)
    service = request.app.state.discord_service
    return [_webhook_to_frontend(entry, service.get_stats(entry.id)) for entry in entries]


@router.post("/discord/webhooks")
async def create_webhook(
    payload: FrontendWebhookCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        flags = _events_to_flags(payload.events)
        # Validate Discord webhook URL to prevent SSRF
        _ = payload.validated_url
        create_data = DiscordWebhookCreate(url=payload.url, **flags)
        entry = await request.app.state.discord_service.create_webhook(session, create_data)
        return _webhook_to_frontend(entry)
    except Exception:
        logger.exception("Failed to create Discord webhook")
        raise HTTPException(status_code=500, detail="Failed to create webhook") from None


@router.put("/discord/webhooks/{webhook_id}")
async def update_webhook(
    webhook_id: int,
    payload: FrontendWebhookUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        flags = _events_to_flags(payload.events) if payload.events is not None else {}
        if payload.enabled is not None:
            flags['enabled'] = payload.enabled
        if payload.name is not None:
            flags['name'] = payload.name
        update_data = DiscordWebhookUpdate(**flags) if flags else DiscordWebhookUpdate()
        entry = await request.app.state.discord_service.update_webhook(session, webhook_id, update_data)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _webhook_to_frontend(entry)


@router.delete("/discord/webhooks/{webhook_id}")
async def delete_webhook(
    webhook_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str | int]:
    try:
        await request.app.state.discord_service.delete_webhook(session, webhook_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok", "webhook_id": webhook_id}


@router.post("/discord/test")
async def send_test(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        count = await request.app.state.discord_service.send_test(session, None, "Dashboard connectivity test")
    except LookupError:
        count = 0
    except Exception:
        logger.exception("Discord test send failed")
        return {"success": False, "message": "Failed to send test notification"}
    return {"success": True, "message": f"Queued {count} test(s)"}


@router.post("/discord/announce")
async def send_announcement(
    payload: FrontendAnnouncement,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        count = await request.app.state.discord_service.announce(session, "Announcement", payload.text, "announcement")
    except Exception:
        logger.exception("Discord announcement dispatch failed")
        return {"success": False, "message": "Failed to send announcement"}
    return {"success": True, "message": f"Queued {count} notification(s)"}
