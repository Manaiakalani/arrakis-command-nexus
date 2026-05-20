from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from models.discord import (
    DiscordAnnouncementRequest,
    DiscordTestRequest,
    DiscordWebhookCreate,
    DiscordWebhookEntry,
    DiscordWebhookUpdate,
)

router = APIRouter(tags=["discord"])


@router.get("/discord/webhooks", response_model=list[DiscordWebhookEntry])
async def list_webhooks(request: Request, session: AsyncSession = Depends(get_session)) -> list[DiscordWebhookEntry]:
    entries = await request.app.state.discord_service.list_webhooks(session)
    return [DiscordWebhookEntry.model_validate(entry) for entry in entries]


@router.post("/discord/webhooks", response_model=DiscordWebhookEntry)
async def create_webhook(
    payload: DiscordWebhookCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> DiscordWebhookEntry:
    entry = await request.app.state.discord_service.create_webhook(session, payload)
    return DiscordWebhookEntry.model_validate(entry)


@router.put("/discord/webhooks/{webhook_id}", response_model=DiscordWebhookEntry)
async def update_webhook(
    webhook_id: int,
    payload: DiscordWebhookUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> DiscordWebhookEntry:
    try:
        entry = await request.app.state.discord_service.update_webhook(session, webhook_id, payload)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return DiscordWebhookEntry.model_validate(entry)


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
    payload: DiscordTestRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, int]:
    try:
        count = await request.app.state.discord_service.send_test(session, payload.webhook_id, payload.message)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"queued": count}


@router.post("/discord/announce")
async def send_announcement(
    payload: DiscordAnnouncementRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, int]:
    count = await request.app.state.discord_service.announce(session, payload.title, payload.message, payload.event_type)
    return {"queued": count}
