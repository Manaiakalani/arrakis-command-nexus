from __future__ import annotations

from fastapi import APIRouter, Request

from models.server import MapStatus

router = APIRouter(tags=["maps"])


@router.get("/maps", response_model=list[MapStatus])
async def list_maps(request: Request) -> list[MapStatus]:
    return await request.app.state.docker_service.list_map_statuses()


@router.post("/maps/{name}/start")
async def start_map(name: str, request: Request) -> dict[str, str]:
    return await request.app.state.docker_service.start_container(name)


@router.post("/maps/{name}/stop")
async def stop_map(name: str, request: Request) -> dict[str, str]:
    return await request.app.state.docker_service.stop_container(name)


@router.post("/maps/{name}/restart")
async def restart_map(name: str, request: Request) -> dict[str, str]:
    return await request.app.state.docker_service.restart_container(name)
