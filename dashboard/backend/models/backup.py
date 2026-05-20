from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class BackupEntry(BaseModel):
    id: str
    filename: str
    path: str
    size_bytes: int | None = None
    created_at: datetime | None = None
    metadata: dict[str, str] = Field(default_factory=dict)
