from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter(tags=["restart-schedule"])


class RestartScheduleUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    intervalHours: int | None = Field(default=None, ge=1)
    warningMinutes: list[int] | None = None


class RestartNowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    warningMinutes: int | None = Field(default=0, ge=0)


@router.get("/restart/schedule")
async def get_restart_schedule(request: Request) -> dict[str, object]:
    return request.app.state.restart_scheduler.get_status()


@router.put("/restart/schedule")
async def update_restart_schedule(payload: RestartScheduleUpdateRequest, request: Request) -> dict[str, object]:
    try:
        return await request.app.state.restart_scheduler.update_settings(
            enabled=payload.enabled,
            interval_hours=payload.intervalHours,
            warning_minutes=payload.warningMinutes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/restart/now")
async def restart_now(request: Request, payload: RestartNowRequest | None = None) -> dict[str, object]:
    try:
        return await request.app.state.restart_scheduler.trigger_restart_now((payload.warningMinutes if payload else 0) or 0)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
