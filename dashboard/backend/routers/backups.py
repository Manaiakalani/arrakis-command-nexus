from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(tags=["backups"])
logger = logging.getLogger(__name__)

_SCOPE_TO_FRONTEND = {
    "full": "full",
    "config": "configs",
    "configs": "configs",
    "db": "database",
    "database": "database",
}


class BackupCreateRequest(BaseModel):
    scope: str = "full"


class BackupScheduleUpdateRequest(BaseModel):
    enabled: bool | None = None
    intervalHours: int | None = Field(default=None, ge=1)
    retentionDays: int | None = Field(default=None, ge=0)


def _backup_to_frontend(entry) -> dict:
    created = getattr(entry, "created_at", None)
    meta = getattr(entry, "metadata", {}) or {}
    raw_scope = str(meta.get("scope", "full")).lower()
    return {
        "id": getattr(entry, "id", ""),
        "name": getattr(entry, "filename", getattr(entry, "id", "")),
        "scope": _SCOPE_TO_FRONTEND.get(raw_scope, "full"),
        "status": "ready",
        "sizeBytes": getattr(entry, "size_bytes", 0) or 0,
        "createdAt": created.isoformat() if created else datetime.now(timezone.utc).isoformat(),
        "createdBy": meta.get("created_by", "system"),
    }


@router.get("/backups")
async def list_backups(request: Request) -> list[dict]:
    entries = await request.app.state.backup_service.list_backups()
    return [_backup_to_frontend(e) for e in entries]


@router.post("/backups")
async def create_backup(payload: BackupCreateRequest, request: Request) -> dict:
    try:
        entry = await request.app.state.backup_service.create_backup(payload.scope)
        return _backup_to_frontend(entry)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        logger.warning("Backup creation failed: %s", exc)
        return {
            "id": "error",
            "name": "Backup failed",
            "scope": "full",
            "status": "failed",
            "sizeBytes": 0,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "createdBy": "system",
        }


@router.get("/backups/schedule")
async def get_backup_schedule(request: Request) -> dict[str, object]:
    return request.app.state.backup_scheduler.get_status()


@router.put("/backups/schedule")
async def update_backup_schedule(payload: BackupScheduleUpdateRequest, request: Request) -> dict[str, object]:
    try:
        return await request.app.state.backup_scheduler.update_settings(
            enabled=payload.enabled,
            interval_hours=payload.intervalHours,
            retention_days=payload.retentionDays,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/backups/{backup_id}/restore")
async def restore_backup(backup_id: str, request: Request) -> dict:
    try:
        result = await request.app.state.backup_service.trigger_restore(backup_id)
        return {"status": "ok", "backup_id": backup_id, "result": result}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/backups/{backup_id}")
async def delete_backup(backup_id: str, request: Request) -> dict[str, str]:
    try:
        await request.app.state.backup_service.delete_backup(backup_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok", "backup_id": backup_id}
