from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AllowlistRequest(BaseModel):
    steam_id: str = Field(min_length=1)
    player_name: str | None = None


class AllowlistEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    steam_id: str
    player_name: str | None = None
    added_at: datetime
