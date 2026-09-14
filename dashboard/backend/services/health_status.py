"""Single health vocabulary for REST /status and SSE ChangeDetector."""

from __future__ import annotations

from typing import Any

HEALTH_MAP = {
    "running": "healthy",
    "stopped": "stopped",
    "completed": "completed",
    "error": "offline",
    "exited": "stopped",
}

READINESS_TO_HEALTH = {"ok": "healthy", "warn": "degraded", "fail": "offline"}

INIT_CONTAINERS = {"db-init", "db_init", "dbinit"}


def is_init_container(name: str) -> bool:
    short = name.replace("dune-awakening-", "").replace("-1", "").lower()
    return any(tag in short for tag in INIT_CONTAINERS)


def service_to_frontend(svc: Any) -> dict:
    """Convert a Docker ServiceStatus object into the dashboard payload."""
    name = getattr(svc, "name", "") or ""
    raw_status = getattr(svc, "status", "stopped")
    health = getattr(svc, "health", None)
    fe_status = HEALTH_MAP.get(raw_status, "offline")
    if health == "unhealthy":
        fe_status = "degraded"
    init = is_init_container(name)
    if init and raw_status in ("completed", "exited"):
        fe_status = "completed"
    label = name.replace("dune-awakening-", "").replace("-1", "").replace("_", " ").title()
    message = health or raw_status
    if init and fe_status == "completed":
        message = "Finished successfully"
    return {
        "name": name,
        "label": label,
        "status": fe_status,
        "latencyMs": getattr(svc, "latency_ms", 0),
        "message": message,
        "isInit": init,
    }


def readiness_to_health(readiness_status: str) -> str:
    return READINESS_TO_HEALTH.get(readiness_status, "offline")
