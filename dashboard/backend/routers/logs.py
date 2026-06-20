from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, Response
from sse_starlette.sse import EventSourceResponse

router = APIRouter(tags=["logs"])

_VALID_FORMATS = {"txt", "json", "csv"}


def _validate_service_name(request: Request, service: str | None) -> None:
    if service is None:
        return
    try:
        request.app.state.docker_service.validate_container_name(service)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/logs/download")
async def download_logs(
    request: Request,
    service: str | None = Query(default=None),
    tail: int = Query(default=500, ge=1, le=5000),
    format: str = Query(default="txt", pattern="^(txt|json|csv)$"),
) -> Response:
    _validate_service_name(request, service)
    if format not in _VALID_FORMATS:
        raise HTTPException(status_code=400, detail=f"Unknown format '{format}'")
    log_service = request.app.state.log_service
    docker_service = log_service.docker_service

    if service:
        services = [service]
    else:
        services = [c.name for c in await docker_service.list_containers() if c.status == "running"]

    rows: list[dict[str, str]] = []
    for svc in services:
        entries = await log_service.recent_logs(svc, tail=tail)
        for entry in entries:
            rows.append({
                "timestamp": str(entry.get("timestamp", "")),
                "severity": str(entry.get("severity", "INFO")),
                "service": svc,
                "message": str(entry.get("message", "")),
            })

    rows.sort(key=lambda r: r["timestamp"])
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"nexus-logs-{stamp}.{format}"
    disposition = f'attachment; filename="{filename}"'

    if format == "json":
        body = json.dumps(rows, indent=2)
        return Response(
            content=body,
            media_type="application/json",
            headers={"Content-Disposition": disposition},
        )

    if format == "csv":
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=["timestamp", "severity", "service", "message"])
        writer.writeheader()
        writer.writerows(rows)
        return Response(
            content=buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": disposition},
        )

    lines = [
        f"{r['timestamp']}  [{r['severity']:5s}]  {r['service']}  {r['message']}"
        for r in rows
    ]
    content = "\n".join(lines) or "No log entries found."
    return PlainTextResponse(
        content=content,
        media_type="text/plain",
        headers={"Content-Disposition": disposition},
    )


@router.get("/logs/stream")
async def stream_logs(
    request: Request,
    service: str | None = Query(default=None),
    tail: int = Query(default=100, ge=1, le=1000),
) -> EventSourceResponse:
    _validate_service_name(request, service)
    return EventSourceResponse(request.app.state.log_service.stream_logs(service=service, tail=tail))


@router.get("/logs/{service}")
async def get_logs(
    service: str,
    request: Request,
    tail: int = Query(default=200, ge=1, le=1000),
) -> dict[str, object]:
    _validate_service_name(request, service)
    return {
        "service": service,
        "entries": await request.app.state.log_service.recent_logs(service, tail=tail),
    }
