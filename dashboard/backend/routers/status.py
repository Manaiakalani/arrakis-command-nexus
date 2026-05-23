from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import APIRouter, Request

router = APIRouter(tags=["status"])

_HEALTH_MAP = {"running": "healthy", "stopped": "stopped", "error": "offline"}


def _service_to_frontend(svc) -> dict:
    """Convert backend ServiceStatus to the shape the frontend expects."""
    name = getattr(svc, "name", "")
    raw_status = getattr(svc, "status", "stopped")
    health = getattr(svc, "health", None)
    fe_status = _HEALTH_MAP.get(raw_status, "offline")
    if health == "unhealthy":
        fe_status = "degraded"
    label = name.replace("dune-awakening-", "").replace("-1", "").replace("_", " ").title()
    return {
        "name": name,
        "label": label,
        "status": fe_status,
        "latencyMs": 0,
        "message": health or raw_status,
    }


@router.get("/status")
async def get_status(request: Request) -> dict:
    docker_service = request.app.state.docker_service
    postgres_service = request.app.state.postgres_service
    services = await docker_service.list_containers()
    readiness = docker_service.evaluate_readiness(services)
    players = await postgres_service.get_online_players()
    uptime = docker_service.calculate_uptime(services)

    map_roles = {"overmap", "survival"}
    maps_active = sum(
        1 for s in services
        if getattr(s, "status", "") == "running"
        and docker_service._map_role(getattr(s, "name", "")) in map_roles
    )

    status_map = {"ok": "healthy", "warn": "degraded", "fail": "offline"}
    return {
        "serverName": os.getenv("DUNE_WORLD_NAME", "Dune Awakening"),
        "region": os.getenv("WORLD_REGION", "North America"),
        "status": status_map.get(readiness["status"], "offline"),
        "uptimeSeconds": uptime or 0,
        "playersOnline": len(players),
        "mapsActive": maps_active,
        "maxPlayers": int(os.getenv("DUNE_MAX_PLAYERS", "70")),
        "version": os.getenv("DUNE_IMAGE_TAG", "1960494-0-shipping"),
        "services": [_service_to_frontend(s) for s in services],
    }


@router.get("/health")
async def get_health(request: Request) -> dict[str, object]:
    return {
        "status": "ok",
        "services": {
            "docker": request.app.state.docker_service.available,
            "postgres": request.app.state.postgres_service.pool is not None,
            "metrics": bool(request.app.state.metrics_service.snapshots),
        },
    }


@router.get("/ready")
async def get_ready(request: Request) -> dict:
    raw = await request.app.state.docker_service.get_readiness()
    checks = []
    for name, detail in raw.get("details", {}).items():
        if isinstance(detail, dict):
            label = name.replace("dune-awakening-", "").replace("-1", "")
            check_status = "ok" if detail.get("status") == "running" else "fail"
            if detail.get("health") == "unhealthy":
                check_status = "warn"
            checks.append({
                "name": label,
                "status": check_status,
                "message": detail.get("role", "service"),
            })
    return {
        "status": raw.get("status", "warn"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
    }
