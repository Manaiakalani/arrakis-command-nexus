from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(tags=["backups"])


def _backup_to_frontend(entry) -> dict:
    """Convert backend BackupEntry to frontend expected shape."""
    created = getattr(entry, "created_at", None)
    meta = getattr(entry, "metadata", {}) or {}
    return {
        "id": getattr(entry, "id", ""),
        "name": getattr(entry, "filename", getattr(entry, "id", "")),
        "scope": meta.get("scope", "full"),
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
async def create_backup(request: Request) -> dict:
    try:
        result = await request.app.state.backup_service.trigger_backup()
        if isinstance(result, dict) and result.get("returncode", 0) != 0:
            return {
                "id": "error",
                "name": "Backup failed",
                "scope": "full",
                "status": "failed",
                "sizeBytes": 0,
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "createdBy": "system",
            }
        # If trigger_backup returns a BackupEntry, convert it
        if hasattr(result, "id"):
            return _backup_to_frontend(result)
        return {
            "id": "pending",
            "name": "Backup initiated",
            "scope": "full",
            "status": "running",
            "sizeBytes": 0,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "createdBy": "system",
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


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
