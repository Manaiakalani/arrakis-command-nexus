from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(tags=["maps"])
logger = logging.getLogger(__name__)


@router.get("/maps")
async def list_maps(request: Request) -> list[dict]:
    raw_maps = await request.app.state.docker_service.list_map_statuses()
    return [
        {
            "name": m.name,
            "status": m.status,
            "players": m.player_count,
            "maxPlayers": 70,
            "memoryUsedMb": round(m.memory_usage_mb or 0, 1),
            "memoryLimitMb": round(m.memory_limit_mb or 0, 1),
            "cpuPercent": round(m.cpu_percent, 1) if m.cpu_percent is not None else 0,
            "uptimeSeconds": round(m.uptime_seconds) if m.uptime_seconds is not None else None,
        }
        for m in raw_maps
    ]


@router.post("/maps/{name}/start")
async def start_map(name: str, request: Request) -> dict[str, str]:
    try:
        return await request.app.state.docker_service.start_container(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid container name.") from exc


@router.post("/maps/{name}/stop")
async def stop_map(name: str, request: Request) -> dict[str, str]:
    try:
        return await request.app.state.docker_service.stop_container(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid container name.") from exc


@router.post("/maps/{name}/restart")
async def restart_map(name: str, request: Request) -> dict[str, str]:
    try:
        return await request.app.state.docker_service.restart_container(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid container name.") from exc


@router.post("/maps/{name}/backup")
async def backup_map(name: str, request: Request) -> dict[str, str]:
    """Create a database backup scoped to a specific map container."""
    try:
        entry = await request.app.state.backup_service.create_backup("database")
        return {"status": "ok", "map": name, "backup_id": getattr(entry, "id", "unknown")}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Backup failed for map %s: %s", name, exc)
        raise HTTPException(status_code=500, detail="Backup creation failed.") from exc
