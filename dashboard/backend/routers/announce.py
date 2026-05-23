from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(tags=["announcements"])


class AnnouncementRequest(BaseModel):
    message: str
    sender: str | None = None


class PreRestartRequest(BaseModel):
    minutes: int = 5


@router.post("/announce")
async def send_announcement(payload: AnnouncementRequest, request: Request) -> dict[str, bool | str]:
    service = request.app.state.announce_service
    success = await asyncio.to_thread(service.send_announcement, payload.message, payload.sender)
    return {"success": success, "message": "Announcement sent" if success else "Failed to send"}


@router.post("/announce/pre-restart")
async def send_pre_restart(payload: PreRestartRequest, request: Request) -> dict[str, bool]:
    service = request.app.state.announce_service
    success = await asyncio.to_thread(service.send_pre_restart_warning, payload.minutes)
    return {"success": success}


@router.get("/announce/history")
async def get_history(request: Request) -> list[dict]:
    service = request.app.state.announce_service
    return list(reversed(service.history))
