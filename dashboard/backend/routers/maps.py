from __future__ import annotations

import logging
import os
import re
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from db.models import AuditLog
from services.cache import invalidate_overview

router = APIRouter(tags=["maps"])
logger = logging.getLogger(__name__)

VEHICLE_CLASS_PATTERNS = [
    "%ornithopter%",
    "%sandbike%",
    "%buggy%",
    "%sandcrawler%",
    "%quad%",
    "%harvester%",
    "BP_VehicleOrnithopter%",
    "BP_VehicleSandbike%",
    "BP_VehicleBuggy%",
    "BP_VehicleSandcrawler%",
    "%_Pawn_Vehicle_%",
]


class VehicleTeleportRequest(BaseModel):
    actor_id: int
    target_x: float
    target_y: float
    target_z: float | None = None


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


@router.get("/maps/{map_name}/vehicles")
async def list_vehicles(map_name: str, request: Request) -> list[dict]:
    """Return vehicle actors with world coordinates from dune.actors."""
    pool = getattr(request.app.state.postgres_service, "pool", None)
    if pool is None:
        return []

    async with pool.acquire() as conn:
        columns = await _get_actor_columns(conn)
        class_column = _actor_class_column(columns)
        if class_column is None:
            logger.warning("dune.actors has no class/class_name column for vehicle tracking")
            return []

        owner_expr = _first_column_expr(columns, ("owner_player_id", "owner_account_id", "owner_id", "account_id"))
        last_seen_expr = _first_column_expr(columns, ("last_seen_at", "last_seen", "updated_at", "modified_at", "created_at"))
        select_map = ", a.map AS map_name" if "map" in columns else ", NULL AS map_name"
        where = ["a.transform IS NOT NULL", f"a.{class_column}::text ILIKE ANY($1::text[])"]
        params: list[Any] = [VEHICLE_CLASS_PATTERNS]
        normalized_map = map_name.lower().replace("_", "-")
        if "map" in columns and normalized_map not in {"all", "*", "hagga-basin"}:
            params.append(map_name)
            where.append(f"a.map = ${len(params)}")

        rows = await conn.fetch(f"""
            SELECT
                a.id AS actor_id,
                a.{class_column}::text AS class_name,
                a.transform::text AS transform,
                {owner_expr} AS owner_player_id_if_any,
                {last_seen_expr} AS last_seen_at
                {select_map}
            FROM dune.actors a
            WHERE {' AND '.join(where)}
            ORDER BY a.id
            LIMIT 1000
        """, *params)

    vehicles = []
    for row in rows:
        transform_str = row["transform"] or ""
        x, y, z = _parse_transform(transform_str)
        class_name = row["class_name"] or ""
        vehicles.append({
            "actor_id": row["actor_id"],
            "class_name": class_name,
            "vehicle_type": _vehicle_type(class_name),
            "x": x,
            "y": y,
            "z": z,
            "owner_player_id_if_any": row["owner_player_id_if_any"],
            "last_seen_at": _serialize_value(row["last_seen_at"]),
            "map_name": row["map_name"],
        })
    return vehicles


@router.post("/maps/{map_name}/teleport-vehicle")
async def teleport_vehicle(
    map_name: str,
    payload: VehicleTeleportRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Move a vehicle actor by updating its transform while preserving rotation."""
    if os.getenv("DUNE_ADMIN_MUTATIONS_ENABLED", "false").lower() != "true":
        raise HTTPException(status_code=403, detail="Mutations disabled. Set DUNE_ADMIN_MUTATIONS_ENABLED=true")

    pool = getattr(request.app.state.postgres_service, "pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="No database connection")

    async with pool.acquire() as conn:
        columns = await _get_actor_columns(conn)
        class_column = _actor_class_column(columns)
        if class_column is None:
            raise HTTPException(status_code=501, detail="Vehicle tracking is not supported on this server schema")

        actor = await conn.fetchrow(f"""
            SELECT id, {class_column}::text AS class_name, transform::text AS prev_transform
            FROM dune.actors
            WHERE id = $1
        """, payload.actor_id)
        if actor is None:
            raise HTTPException(status_code=404, detail="Vehicle actor not found")
        class_name = actor["class_name"] or ""
        if not _is_vehicle_class(class_name):
            raise HTTPException(status_code=422, detail="Actor is not a recognized vehicle")

        prev_transform = actor["prev_transform"]
        if not prev_transform:
            raise HTTPException(status_code=422, detail="Vehicle actor has no transform")
        _current_x, _current_y, current_z = _parse_transform(prev_transform)
        target_z = payload.target_z if payload.target_z is not None else current_z

        updated = await conn.fetchrow("""
            UPDATE dune.actors
            SET transform = ROW(
                ROW($2, $3, $4)::vector,
                (transform).rotation
            )::transform
            WHERE id = $1
            RETURNING transform::text AS new_transform
        """, payload.actor_id, payload.target_x, payload.target_y, target_z)

    new_transform = updated["new_transform"] if updated else None
    session.add(AuditLog(
        action="vehicle_teleport",
        details={
            "map_name": map_name,
            "actor_id": payload.actor_id,
            "target_x": payload.target_x,
            "target_y": payload.target_y,
            "target_z": target_z,
            "prev_transform": prev_transform,
            "new_transform": new_transform,
        },
        performed_by=request.headers.get("X-Admin-User", "dashboard"),
    ))
    await session.commit()

    return {"ok": True, "prev_transform": prev_transform, "new_transform": new_transform}


def _parse_transform(transform_str: str) -> tuple[float, float, float]:
    """Extract x, y, z from a Postgres composite transform string."""
    numbers = re.findall(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?', transform_str)
    if len(numbers) >= 3:
        return float(numbers[0]), float(numbers[1]), float(numbers[2])
    return 0.0, 0.0, 0.0


async def _get_actor_columns(conn: Any) -> set[str]:
    rows = await conn.fetch("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'dune'
          AND table_name = 'actors'
    """)
    return {row["column_name"] for row in rows}


def _actor_class_column(columns: set[str]) -> str | None:
    if "class_name" in columns:
        return "class_name"
    if "class" in columns:
        return "class"
    return None


def _first_column_expr(columns: set[str], candidates: tuple[str, ...]) -> str:
    for column in candidates:
        if column in columns:
            return f"a.{column}"
    return "NULL"


def _vehicle_type(class_name: str) -> str:
    lowered = class_name.lower()
    if "ornithopter" in lowered:
        return "ornithopter"
    if "sandbike" in lowered:
        return "sandbike"
    if "buggy" in lowered:
        return "buggy"
    if "sandcrawler" in lowered:
        return "sandcrawler"
    if "quad" in lowered:
        return "quad"
    if "harvester" in lowered:
        return "harvester"
    return "vehicle"


def _is_vehicle_class(class_name: str) -> bool:
    lowered = class_name.lower()
    tokens = ("ornithopter", "sandbike", "buggy", "sandcrawler", "quad", "harvester", "_pawn_vehicle_")
    return any(token in lowered for token in tokens)


def _serialize_value(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


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
        result = await request.app.state.docker_service.start_container(name)
        invalidate_overview()
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid container name.") from exc


@router.post("/maps/{name}/stop")
async def stop_map(name: str, request: Request) -> dict[str, str]:
    try:
        result = await request.app.state.docker_service.stop_container(name)
        invalidate_overview()
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid container name.") from exc


@router.post("/maps/{name}/restart")
async def restart_map(name: str, request: Request) -> dict[str, str]:
    try:
        result = await request.app.state.docker_service.restart_container(name)
        invalidate_overview()
        return result
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
