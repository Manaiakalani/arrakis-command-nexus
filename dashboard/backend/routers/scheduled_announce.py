from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(tags=["announcements"])


class ScheduledAnnouncementCreateRequest(BaseModel):
    message: str
    sender: str | None = None
    interval_minutes: int | None = Field(default=None, ge=1)
    run_at: datetime | None = None
    enabled: bool = True


class ScheduledAnnouncementUpdateRequest(BaseModel):
    message: str | None = None
    sender: str | None = None
    interval_minutes: int | None = Field(default=None, ge=1)
    run_at: datetime | None = None
    enabled: bool | None = None


class ScheduledAnnouncementToggleRequest(BaseModel):
    enabled: bool | None = None


@router.get("/announce/scheduled")
async def list_scheduled_announcements(request: Request) -> list[dict[str, object]]:
    return request.app.state.announce_scheduler.list_announcements()


@router.post("/announce/scheduled")
async def create_scheduled_announcement(
    payload: ScheduledAnnouncementCreateRequest,
    request: Request,
) -> dict[str, object]:
    scheduler = request.app.state.announce_scheduler
    try:
        return await scheduler.create_announcement(
            message=payload.message,
            sender=payload.sender,
            interval_minutes=payload.interval_minutes,
            run_at=payload.run_at,
            enabled=payload.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/announce/scheduled/{announcement_id}")
async def update_scheduled_announcement(
    announcement_id: str,
    payload: ScheduledAnnouncementUpdateRequest,
    request: Request,
) -> dict[str, object]:
    scheduler = request.app.state.announce_scheduler
    try:
        return await scheduler.update_announcement(
            announcement_id,
            message=payload.message,
            sender=payload.sender,
            interval_minutes=payload.interval_minutes,
            run_at=payload.run_at,
            enabled=payload.enabled,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Scheduled announcement not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/announce/scheduled/{announcement_id}")
async def delete_scheduled_announcement(announcement_id: str, request: Request) -> dict[str, str]:
    scheduler = request.app.state.announce_scheduler
    try:
        await scheduler.delete_announcement(announcement_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Scheduled announcement not found") from exc
    return {"status": "ok", "id": announcement_id}


@router.post("/announce/scheduled/{announcement_id}/toggle")
async def toggle_scheduled_announcement(
    announcement_id: str,
    request: Request,
    payload: ScheduledAnnouncementToggleRequest | None = None,
) -> dict[str, object]:
    scheduler = request.app.state.announce_scheduler
    try:
        return await scheduler.toggle_announcement(announcement_id, payload.enabled if payload else None)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Scheduled announcement not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
