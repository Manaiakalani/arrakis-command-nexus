from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SystemMetricSnapshot(BaseModel):
    timestamp: datetime
    cpu_percent: float
    memory_percent: float
    memory_used_mb: float
    memory_total_mb: float
    disk_percent: float
    disk_used_gb: float
    disk_total_gb: float
    network_sent_bps: float = 0.0
    network_recv_bps: float = 0.0
    disk_read_bps: float = 0.0
    disk_write_bps: float = 0.0
    load: dict[str, Any] = Field(default_factory=dict)
