from __future__ import annotations

import os

from fastapi import APIRouter, Request

from models.server import ServerOverview

router = APIRouter(tags=["status"])


@router.get("/status", response_model=ServerOverview)
async def get_status(request: Request) -> ServerOverview:
    docker_service = request.app.state.docker_service
    postgres_service = request.app.state.postgres_service
    services = await docker_service.list_containers()
    readiness = await docker_service.get_readiness()
    players = await postgres_service.get_online_players()
    uptime = await docker_service.get_uptime_seconds()
    return ServerOverview(
        world_name=os.getenv("DUNE_WORLD_NAME", "Dune Awakening"),
        profile=os.getenv("DUNE_SERVER_PROFILE", "default"),
        uptime=uptime,
        total_players=len(players),
        services=services,
        readiness=readiness["status"],
    )


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
async def get_ready(request: Request) -> dict[str, object]:
    return await request.app.state.docker_service.get_readiness()
