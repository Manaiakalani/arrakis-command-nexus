from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(tags=["maps"])


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
            "cpuPercent": None,
            "uptimeSeconds": None,
        }
        for m in raw_maps
    ]


@router.post("/maps/{name}/start")
async def start_map(name: str, request: Request) -> dict[str, str]:
    return await request.app.state.docker_service.start_container(name)


@router.post("/maps/{name}/stop")
async def stop_map(name: str, request: Request) -> dict[str, str]:
    return await request.app.state.docker_service.stop_container(name)


@router.post("/maps/{name}/restart")
async def restart_map(name: str, request: Request) -> dict[str, str]:
    return await request.app.state.docker_service.restart_container(name)
