from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class Player(BaseModel):
    steam_id: str
    name: str
    map_name: str | None = None
    position: dict[str, float] | None = None
    session_start: datetime | None = None
    is_online: bool = True
    life_state: str | None = None
    server_id: str | None = None
    platform: str | None = None


class BanRequest(BaseModel):
    steam_id: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    duration_hours: int | None = Field(default=None, ge=1)


class BanEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    steam_id: str
    player_name: str | None = None
    reason: str
    banned_at: datetime
    banned_until: datetime | None = None
    banned_by: str
