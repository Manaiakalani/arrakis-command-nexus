from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ServiceStatus(BaseModel):
    name: str
    status: Literal["running", "stopped", "completed", "error"]
    health: str | None = None
    container_id: str | None = None
    image: str | None = None
    created: str | None = None
    ports: list[str] = Field(default_factory=list)
    latency_ms: int = 0


class ServerOverview(BaseModel):
    world_name: str
    profile: str
    uptime: float | None = None
    total_players: int = 0
    services: list[ServiceStatus] = Field(default_factory=list)
    readiness: Literal["ok", "warn", "fail"]


class MapStatus(BaseModel):
    name: str
    status: Literal["running", "stopped", "completed", "error"]
    player_count: int = 0
    memory_usage_mb: float | None = None
    memory_limit_mb: float | None = None
    cpu_percent: float | None = None
    uptime_seconds: float | None = None
    port: int | None = None
    partition: str | None = None
