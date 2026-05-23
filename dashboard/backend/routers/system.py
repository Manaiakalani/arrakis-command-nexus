from __future__ import annotations

import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query, Request

router = APIRouter(tags=["system"])

_BOOT_TIME: float | None = None
_RANGE_TO_DURATION = {
    "15m": timedelta(minutes=15),
    "1h": timedelta(hours=1),
    "6h": timedelta(hours=6),
    "12h": timedelta(hours=12),
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}
_DEGRADED_CPU_THRESHOLD = 85
_DEGRADED_MEMORY_THRESHOLD = 85
_DEGRADED_DISK_THRESHOLD = 90


def _get_uptime_seconds() -> float:
    """Return host uptime in seconds via psutil or /proc/uptime."""
    global _BOOT_TIME
    if _BOOT_TIME is None:
        try:
            import psutil

            _BOOT_TIME = psutil.boot_time()
        except Exception:
            try:
                with open("/proc/uptime") as f:
                    return float(f.read().split()[0])
            except Exception:
                return 0
    return max(0, time.time() - _BOOT_TIME)


def _parse_range_to_duration(range_value: str) -> timedelta:
    normalized = (range_value or "24h").strip().lower()
    if normalized in _RANGE_TO_DURATION:
        return _RANGE_TO_DURATION[normalized]

    match = re.fullmatch(r"(\d+)([mhd])", normalized)
    if not match:
        return _RANGE_TO_DURATION["24h"]

    quantity = max(int(match.group(1)), 1)
    unit = match.group(2)
    if unit == "m":
        return timedelta(minutes=quantity)
    if unit == "d":
        return timedelta(days=quantity)
    return timedelta(hours=quantity)


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
        "uptimeSeconds": round(_get_uptime_seconds()),
    }


def _snapshot_status(snapshot: Any) -> str:
    cpu_percent = getattr(snapshot, "cpu_percent", 0)
    memory_percent = getattr(snapshot, "memory_percent", 0)
    disk_percent = getattr(snapshot, "disk_percent", 0)
    if (
        cpu_percent >= _DEGRADED_CPU_THRESHOLD
        or memory_percent >= _DEGRADED_MEMORY_THRESHOLD
        or disk_percent >= _DEGRADED_DISK_THRESHOLD
    ):
        return "degraded"
    return "up"


def _append_segment(segments: list[dict[str, Any]], start: datetime, end: datetime, status: str) -> None:
    if end <= start:
        return
    if segments and segments[-1]["status"] == status and segments[-1]["end"] >= start - timedelta(seconds=1):
        segments[-1]["end"] = max(segments[-1]["end"], end)
        return
    segments.append({"start": start, "end": end, "status": status})


def _build_uptime_payload(snapshots: list[Any], duration: timedelta, interval_seconds: int) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    window = max(duration, timedelta(minutes=1))
    range_start = now - window
    gap_tolerance = timedelta(seconds=max(interval_seconds * 0.75, 10))
    expected_gap = timedelta(seconds=max(interval_seconds, 1))
    segments: list[dict[str, Any]] = []

    ordered = sorted((snapshot for snapshot in snapshots if getattr(snapshot, "timestamp", now) >= range_start), key=lambda snapshot: snapshot.timestamp)
    if not ordered:
        total_seconds = int(window.total_seconds())
        return {
            "availabilityPercent": 0.0,
            "totalUpSeconds": 0,
            "totalDownSeconds": total_seconds,
            "events": [
                {
                    "timestamp": range_start.isoformat(),
                    "status": "down",
                    "durationSeconds": total_seconds,
                }
            ],
        }

    first_snapshot = ordered[0]
    active_status = _snapshot_status(first_snapshot)
    active_start = range_start
    previous_snapshot = first_snapshot

    for current_snapshot in ordered[1:]:
        current_time = min(current_snapshot.timestamp, now)
        expected_next = min(previous_snapshot.timestamp + expected_gap, now)
        if current_time > expected_next + gap_tolerance:
            _append_segment(segments, active_start, expected_next, active_status)
            _append_segment(segments, expected_next, current_time, "down")
            active_start = current_time
            active_status = _snapshot_status(current_snapshot)
        else:
            current_status = _snapshot_status(current_snapshot)
            if current_status != active_status:
                _append_segment(segments, active_start, current_time, active_status)
                active_start = current_time
                active_status = current_status
        previous_snapshot = current_snapshot

    last_expected = min(previous_snapshot.timestamp + expected_gap, now)
    if now > last_expected + gap_tolerance:
        _append_segment(segments, active_start, last_expected, active_status)
        _append_segment(segments, last_expected, now, "down")
    else:
        _append_segment(segments, active_start, now, active_status)

    total_seconds = max(sum(int((segment["end"] - segment["start"]).total_seconds()) for segment in segments), 1)
    total_down_seconds = sum(int((segment["end"] - segment["start"]).total_seconds()) for segment in segments if segment["status"] == "down")
    total_up_seconds = max(total_seconds - total_down_seconds, 0)
    availability_percent = round((total_up_seconds / total_seconds) * 100, 2)

    return {
        "availabilityPercent": availability_percent,
        "totalUpSeconds": total_up_seconds,
        "totalDownSeconds": total_down_seconds,
        "events": [
            {
                "timestamp": segment["start"].astimezone(timezone.utc).isoformat(),
                "status": segment["status"],
                "durationSeconds": int((segment["end"] - segment["start"]).total_seconds()),
            }
            for segment in segments
        ],
    }


@router.get("/system")
@router.get("/system/metrics")
async def get_system_metrics(request: Request) -> dict[str, object]:
    raw = await request.app.state.metrics_service.get_current_metrics()
    return _format_snapshot(raw)


@router.get("/system/history")
async def get_system_history(
    request: Request,
    range: str = Query(default="24h", alias="range"),
    hours: int | None = Query(default=None, ge=1, le=720),
) -> dict[str, object]:
    duration = timedelta(hours=hours) if hours is not None else _parse_range_to_duration(range)
    history = await request.app.state.metrics_service.get_history(duration=duration)
    points = [_format_snapshot(snapshot) for snapshot in history]
    return {"range": range, "points": points}


@router.get("/system/uptime")
async def get_uptime(request: Request, range: str = Query(default="24h", alias="range")) -> dict[str, Any]:
    """Get uptime and availability data for the requested range."""
    duration = _parse_range_to_duration(range)
    metrics_service = request.app.state.metrics_service
    snapshots = await metrics_service.get_snapshots(duration=duration)
    payload = _build_uptime_payload(snapshots, duration=duration, interval_seconds=metrics_service.interval_seconds)
    return {"range": range, **payload}


@router.get("/system/version")
async def get_version(request: Request) -> dict[str, str]:
    del request
    # Look for VERSION file relative to the project root
    version = os.getenv("DUNE_IMAGE_TAG", "unknown")
    for candidate in [
        Path("/app/VERSION"),
        Path(__file__).resolve().parent.parent.parent / "VERSION",
    ]:
        if candidate.exists():
            version = candidate.read_text(encoding="utf-8").strip() or version
            break
    return {
        "version": version,
        "profile": os.getenv("DEPLOYMENT_PROFILE", "basic"),
        "environment": os.getenv("DUNE_FLS_ENV", "retail"),
    }
