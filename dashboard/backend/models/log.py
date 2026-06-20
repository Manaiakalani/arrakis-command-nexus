from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class LogEntry(BaseModel):
    timestamp: datetime
    service: str
    severity: Literal["ERROR", "WARN", "INFO"]
    message: str

    def model_dump(self, **kwargs):
        d = super().model_dump(**kwargs)
        d["level"] = d["severity"]
        d["id"] = f"{d['timestamp']}-{hash(d['message']) & 0xFFFFFFFF:08x}"
        return d

    def model_dump_json(self, **kwargs):
        import json
        return json.dumps(self.model_dump(mode="json"))
