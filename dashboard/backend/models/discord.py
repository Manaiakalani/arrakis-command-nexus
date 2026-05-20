from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, HttpUrl


class DiscordWebhookCreate(BaseModel):
    url: HttpUrl
    notify_start: bool = True
    notify_stop: bool = True
    notify_crash: bool = True
    notify_player_join: bool = False
    notify_player_leave: bool = False


class DiscordWebhookUpdate(BaseModel):
    notify_start: bool | None = None
    notify_stop: bool | None = None
    notify_crash: bool | None = None
    notify_player_join: bool | None = None
    notify_player_leave: bool | None = None


class DiscordWebhookEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    notify_start: bool
    notify_stop: bool
    notify_crash: bool
    notify_player_join: bool
    notify_player_leave: bool
    created_at: datetime


class DiscordTestRequest(BaseModel):
    webhook_id: int | None = None
    message: str = "Dashboard connectivity test"


class DiscordAnnouncementRequest(BaseModel):
    title: str
    message: str
    event_type: str = "player"
