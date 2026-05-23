from __future__ import annotations

from fastapi import APIRouter, Query, Request

router = APIRouter(tags=["system"])


def _format_snapshot(raw: dict) -> dict:
    """Convert a raw SystemMetricSnapshot dict to the frontend's camelCase format."""
    return {
        "timestamp": raw.get("timestamp"),
        "cpuPercent": round(raw.get("cpu_percent", 0), 1),
        "memoryPercent": round(raw.get("memory_percent", 0), 1),
        "memoryUsedGb": round(raw.get("memory_used_mb", 0) / 1024, 2),
        "memoryTotalGb": round(raw.get("memory_total_mb", 0) / 1024, 2),
        "diskPercent": round(raw.get("disk_percent", 0), 1),
        "diskUsedGb": round(raw.get("disk_used_gb", 0), 2),
        "diskTotalGb": round(raw.get("disk_total_gb", 0), 2),
        "networkInMbps": round(raw.get("network_recv_bps", 0) * 8 / 1_000_000, 3),
        "networkOutMbps": round(raw.get("network_sent_bps", 0) * 8 / 1_000_000, 3),
        "uptimeSeconds": 0,
    }


_RANGE_TO_HOURS = {"1h": 1, "6h": 6, "12h": 12, "24h": 24, "7d": 168}


@router.get("/system")
@router.get("/system/metrics")
async def get_system_metrics(request: Request) -> dict[str, object]:
    raw = await request.app.state.metrics_service.get_current_metrics()
    return _format_snapshot(raw)


@router.get("/system/history")
async def get_system_history(
    request: Request,
    range: str = Query(default="24h", alias="range"),
    hours: int | None = Query(default=None, ge=1, le=168),
) -> dict[str, object]:
    if hours is not None:
        h = hours
    else:
        h = _RANGE_TO_HOURS.get(range, 24)
    history = await request.app.state.metrics_service.get_history(hours=h)
    points = [_format_snapshot(s) for s in history]
    return {"range": range, "points": points}
