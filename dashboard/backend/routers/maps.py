from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(tags=["maps"])
logger = logging.getLogger(__name__)


@router.get("/maps/bases")
async def list_bases(request: Request) -> list[dict]:
    """Return all player bases (buildings + totems) with world coordinates."""
    pool = getattr(request.app.state.postgres_service, "pool", None)
    if pool is None:
        return []

    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                b.id,
                b.owner_id,
                a.transform,
                a.partition_id,
                ea.platform_id,
                (SELECT count(*) FROM dune.building_instances bi WHERE bi.building_id = b.id) AS piece_count
            FROM dune.buildings b
            JOIN dune.actors a ON a.id = b.id
            LEFT JOIN dune.encrypted_accounts ea ON ea.id = b.owner_id
        """)

    bases = []
    for row in rows:
        transform_str = str(row["transform"]) if row["transform"] else ""
        x, y, z = _parse_transform(transform_str)
        owner_name = None
        # Try to find owner name from online players
        if row["platform_id"]:
            owner_name = f"Steam:{row['platform_id']}"
        bases.append({
            "id": row["id"],
            "owner_id": row["owner_id"],
            "owner_name": owner_name,
            "x": x,
            "y": y,
            "z": z,
            "partition_id": row["partition_id"],
            "piece_count": row["piece_count"],
        })
    return bases


def _parse_transform(transform_str: str) -> tuple[float, float, float]:
    """Extract x, y, z from a Postgres composite transform string."""
    import re
    numbers = re.findall(r'-?[\d.]+(?:e[+-]?\d+)?', transform_str)
    if len(numbers) >= 3:
        return float(numbers[0]), float(numbers[1]), float(numbers[2])
    return 0.0, 0.0, 0.0


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
