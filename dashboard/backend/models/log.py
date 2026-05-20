from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class LogEntry(BaseModel):
    timestamp: datetime
    service: str
    severity: Literal["ERROR", "WARN", "INFO"]
    message: str
