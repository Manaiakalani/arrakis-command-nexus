from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Query, Request
from fastapi.responses import PlainTextResponse
from sse_starlette.sse import EventSourceResponse

router = APIRouter(tags=["logs"])


@router.get("/logs/download")
async def download_logs(
    request: Request,
    service: str | None = Query(default=None),
    tail: int = Query(default=500, ge=1, le=5000),
) -> PlainTextResponse:
    log_service = request.app.state.log_service
    docker_service = log_service.docker_service

    if service:
        services = [service]
    else:
        services = [c.name for c in await docker_service.list_containers() if c.status == "running"]

    lines: list[str] = []
    for svc in services:
        entries = await log_service.recent_logs(svc, tail=tail)
        for entry in entries:
            ts = entry.get("timestamp", "")
            sev = entry.get("severity", "INFO")
            msg = entry.get("message", "")
            lines.append(f"{ts}  [{sev:5s}]  {svc}  {msg}")

    lines.sort()
    content = "\n".join(lines) or "No log entries found."
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return PlainTextResponse(
        content=content,
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="nexus-logs-{stamp}.txt"'},
    )


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
