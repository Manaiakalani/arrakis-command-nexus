from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from middleware.request_utils import get_client_ip
from services.env_file import read_env_var

logger = logging.getLogger(__name__)

router = APIRouter(tags=["status"])

_HEALTH_MAP = {"running": "healthy", "stopped": "stopped", "completed": "completed", "error": "offline"}

# Containers that are one-shot init tasks — exited 0 is expected and healthy
_INIT_CONTAINERS = {"db-init", "db_init", "dbinit"}
_PUBLIC_STATUS_RATE_LIMIT = 60
_PUBLIC_STATUS_WINDOW_SECONDS = 60
_public_status_requests: dict[str, list[float]] = defaultdict(list)
_public_status_lock = asyncio.Lock()


def _is_init_container(name: str) -> bool:
    """Check if a container is a known one-shot init task."""
    short = name.replace("dune-awakening-", "").replace("-1", "").lower()
    return any(tag in short for tag in _INIT_CONTAINERS)


def _service_to_frontend(svc) -> dict:
    """Convert backend ServiceStatus to the shape the frontend expects."""
    name = getattr(svc, "name", "")
    raw_status = getattr(svc, "status", "stopped")
    health = getattr(svc, "health", None)
    fe_status = _HEALTH_MAP.get(raw_status, "offline")
    if health == "unhealthy":
        fe_status = "degraded"
    is_init = _is_init_container(name)
    if is_init and raw_status in ("completed", "exited"):
        fe_status = "completed"
    label = name.replace("dune-awakening-", "").replace("-1", "").replace("_", " ").title()
    message = health or raw_status
    if is_init and fe_status == "completed":
        message = "Finished successfully"
    return {
        "name": name,
        "label": label,
        "status": fe_status,
        "latencyMs": getattr(svc, "latency_ms", 0),
        "message": message,
        "isInit": is_init,
    }


async def _enforce_public_status_rate_limit(request: Request) -> None:
    client_ip = get_client_ip(request)
    now = time.monotonic()
    cutoff = now - _PUBLIC_STATUS_WINDOW_SECONDS
    async with _public_status_lock:
        recent_requests = [ts for ts in _public_status_requests.get(client_ip, []) if ts > cutoff]
        if len(recent_requests) >= _PUBLIC_STATUS_RATE_LIMIT:
            _public_status_requests[client_ip] = recent_requests
            retry_after = max(1, int((recent_requests[0] + _PUBLIC_STATUS_WINDOW_SECONDS) - now + 0.999))
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded for the public status endpoint. Limit is 60 requests per minute per IP.",
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(_PUBLIC_STATUS_RATE_LIMIT),
                    "X-RateLimit-Remaining": "0",
                },
            )
        recent_requests.append(now)
        _public_status_requests[client_ip] = recent_requests


@router.get("/status")
async def get_status(request: Request) -> dict:
    docker_service = request.app.state.docker_service
    postgres_service = request.app.state.postgres_service

    services_result, players_result = await asyncio.gather(
        docker_service.list_containers(),
        postgres_service.get_online_players(),
        return_exceptions=True,
    )

    services = services_result if isinstance(services_result, list) else []
    players = players_result if isinstance(players_result, list) else []

    if isinstance(services_result, Exception):
        logger.warning("Failed to list containers for status: %s", services_result)
    if isinstance(players_result, Exception):
        logger.warning("Failed to get online players for status: %s", players_result)
    readiness = docker_service.evaluate_readiness(services)
    uptime = docker_service.calculate_uptime(services)

    map_roles = {"overmap", "survival"}
    maps_active = sum(
        1 for s in services
        if getattr(s, "status", "") == "running"
        and docker_service._map_role(getattr(s, "name", "")) in map_roles
    )

    status_map = {"ok": "healthy", "warn": "degraded", "fail": "offline"}
    return {
        "serverName": read_env_var("WORLD_NAME") or os.getenv("WORLD_NAME") or os.getenv("DUNE_WORLD_NAME", "Dune Awakening Server"),
        "region": os.getenv("WORLD_REGION", "North America"),
        "status": status_map.get(readiness["status"], "offline"),
        "uptimeSeconds": uptime or 0,
        "playersOnline": len(players),
        "mapsActive": maps_active,
        "maxPlayers": int(os.getenv("DUNE_MAX_PLAYERS", "70")),
        "version": os.getenv("DUNE_IMAGE_TAG", "1979201-0-shipping"),
        "services": [_service_to_frontend(s) for s in services],
    }


@router.get("/public/status")
async def get_public_status(request: Request) -> dict:
    """Public-facing status endpoint with no auth and limited data."""
    await _enforce_public_status_rate_limit(request)

    docker_service = request.app.state.docker_service
    services, players_result = await asyncio.gather(
        docker_service.list_containers(),
        request.app.state.postgres_service.get_online_players(),
        return_exceptions=True,
    )
    if isinstance(services, BaseException):
        raise HTTPException(status_code=503, detail="Cannot reach Docker")

    readiness = docker_service.evaluate_readiness(services)
    uptime = docker_service.calculate_uptime(services)

    maps_active = sum(
        1
        for service in services
        if getattr(service, "status", "") == "running"
        and (
            docker_service._map_role(getattr(service, "name", "")) in {"survival", "overmap"}
            or "deepdesert" in getattr(service, "name", "").lower()
        )
    )

    player_count = len(players_result) if isinstance(players_result, list) else 0

    status_map = {"ok": "online", "warn": "degraded", "fail": "offline"}

    return {
        "serverName": read_env_var("WORLD_NAME") or os.getenv("WORLD_NAME") or os.getenv("DUNE_WORLD_NAME", "Dune Awakening Server"),
        "status": status_map.get(readiness.get("status"), "unknown"),
        "playersOnline": player_count,
        "maxPlayers": int(os.getenv("DUNE_MAX_PLAYERS", "70")),
        "mapsActive": maps_active,
        "uptimeSeconds": uptime or 0,
        "version": os.getenv("DUNE_IMAGE_TAG", "unknown"),
        "region": os.getenv("DUNE_SERVER_REGION", os.getenv("WORLD_REGION", "Self-Hosted")),
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
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
            check_status = "ok" if detail.get("status") in ("running", "completed") else "fail"
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


_ALLOWED_ACTIONS = {"start", "stop", "restart"}


@router.post("/services/{name}/{action}")
async def service_action(name: str, action: str, request: Request) -> dict:
    """Start, stop, or restart an individual service container."""
    if action not in _ALLOWED_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Invalid action '{action}'. Must be one of: {', '.join(sorted(_ALLOWED_ACTIONS))}")

    docker_service = request.app.state.docker_service
    handler = getattr(docker_service, f"{action}_container", None)
    if handler is None:
        raise HTTPException(status_code=500, detail=f"Docker service missing '{action}_container' method")

    try:
        result = await handler(name)
    except Exception as exc:  # noqa: BLE001
        logger.error("Service action failed service=%s action=%s: %s", name, action, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Service action failed. Check server logs for details.") from exc

    return {"service": name, "action": action, **result}


# Game-server roles that should be targeted by bulk stop/start
_GAME_SERVER_ROLES = {"overmap", "survival"}
# Infrastructure roles are also stoppable but separated so the UI can differentiate
_INFRA_ROLES = {"gateway", "director", "rabbitmq", "postgres", "text-router", "auth-shim"}


@router.post("/server/{action}")
async def server_bulk_action(action: str, request: Request) -> dict:
    """Stop, start, or restart all game-server containers (maps + infrastructure)."""
    if action not in _ALLOWED_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Invalid action '{action}'. Must be one of: {', '.join(sorted(_ALLOWED_ACTIONS))}")

    docker_service = request.app.state.docker_service
    handler = getattr(docker_service, f"{action}_container", None)
    if handler is None:
        raise HTTPException(status_code=500, detail=f"Docker service missing '{action}_container' method")

    services = await docker_service.list_containers()
    target_roles = _GAME_SERVER_ROLES | _INFRA_ROLES
    targets = [
        svc for svc in services
        if docker_service._map_role(svc.name) in target_roles
    ]

    results: list[dict] = []
    errors: list[dict] = []
    for svc in targets:
        try:
            await handler(svc.name)
            results.append({"service": svc.name, "action": action, "status": "ok"})
        except Exception as exc:  # noqa: BLE001
            logger.error("Bulk %s failed for %s: %s", action, svc.name, exc)
            errors.append({"service": svc.name, "error": str(exc)})

    overall = "ok" if not errors else ("partial" if results else "failed")
    return {
        "status": overall,
        "action": action,
        "succeeded": [r["service"] for r in results],
        "failed": errors,
        "total": len(targets),
    }
