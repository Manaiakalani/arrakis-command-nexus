from __future__ import annotations

from fastapi import APIRouter, Query, Request
from sse_starlette.sse import EventSourceResponse

router = APIRouter(tags=["logs"])


@router.get("/logs/stream")
async def stream_logs(
    request: Request,
    service: str | None = Query(default=None),
    tail: int = Query(default=100, ge=1, le=1000),
) -> EventSourceResponse:
    return EventSourceResponse(request.app.state.log_service.stream_logs(service=service, tail=tail))


@router.get("/logs/{service}")
async def get_logs(
    service: str,
    request: Request,
    tail: int = Query(default=200, ge=1, le=1000),
) -> dict[str, object]:
    return {
        "service": service,
        "entries": await request.app.state.log_service.recent_logs(service, tail=tail),
    }
