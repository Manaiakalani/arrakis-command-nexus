from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from models.backup import BackupEntry

router = APIRouter(tags=["backups"])


@router.get("/backups", response_model=list[BackupEntry])
async def list_backups(request: Request) -> list[BackupEntry]:
    return await request.app.state.backup_service.list_backups()


@router.post("/backups")
async def create_backup(request: Request) -> dict[str, str | int]:
    try:
        return await request.app.state.backup_service.trigger_backup()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/backups/{backup_id}/restore")
async def restore_backup(backup_id: str, request: Request) -> dict[str, str | int]:
    try:
        return await request.app.state.backup_service.trigger_restore(backup_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/backups/{backup_id}")
async def delete_backup(backup_id: str, request: Request) -> dict[str, str]:
    try:
        await request.app.state.backup_service.delete_backup(backup_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok", "backup_id": backup_id}
