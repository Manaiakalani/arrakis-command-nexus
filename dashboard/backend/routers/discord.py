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
    "backup-complete": "notify_crash",
    "player-ban": "notify_player_join",
    "map-restart": "notify_player_leave",
}


def _webhook_to_frontend(entry) -> dict:
    """Convert backend DiscordWebhookEntry to frontend expected shape."""
    events = []
    for event_name, field_name in _EVENT_FIELDS.items():
        if getattr(entry, field_name, False):
            events.append(event_name)
    return {
        "id": str(getattr(entry, "id", "")),
        "name": f"Webhook #{getattr(entry, 'id', '')}",
        "url": str(getattr(entry, "url", "")),
        "enabled": True,
        "events": events,
        "isHealthy": True,
        "lastTriggeredAt": None,
        "recentEvents": [],
    }


class FrontendWebhookCreate(BaseModel):
    name: str | None = None
    url: str
    enabled: bool = True
    events: list[str] | None = None
    isHealthy: bool | None = None
    lastTriggeredAt: str | None = None
    recentEvents: list | None = None


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
    return [_webhook_to_frontend(entry) for entry in entries]


@router.post("/discord/webhooks")
async def create_webhook(
    payload: FrontendWebhookCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    flags = _events_to_flags(payload.events)
    create_data = DiscordWebhookCreate(url=payload.url, **flags)
    entry = await request.app.state.discord_service.create_webhook(session, create_data)
    return _webhook_to_frontend(entry)


@router.put("/discord/webhooks/{webhook_id}")
async def update_webhook(
    webhook_id: int,
    payload: FrontendWebhookUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        flags = _events_to_flags(payload.events) if payload.events is not None else {}
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
    count = await request.app.state.discord_service.announce(session, "Announcement", payload.text, "announcement")
    return {"success": True, "message": f"Queued {count} notification(s)"}
