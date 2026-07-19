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
    notify_update_available: bool = True
    notify_backup: bool = True
    notify_scheduled_restart: bool = True
    notify_admin_action: bool = True
    notify_resource: bool = True
    notify_system: bool = True  # legacy umbrella and migration source


class DiscordWebhookUpdate(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    notify_start: bool | None = None
    notify_stop: bool | None = None
    notify_crash: bool | None = None
    notify_player_join: bool | None = None
    notify_player_leave: bool | None = None
    notify_update_available: bool | None = None
    notify_backup: bool | None = None
    notify_scheduled_restart: bool | None = None
    notify_admin_action: bool | None = None
    notify_resource: bool | None = None
    notify_system: bool | None = None


class DiscordWebhookEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    notify_start: bool
    notify_stop: bool
    notify_crash: bool
    notify_player_join: bool
    notify_player_leave: bool
    notify_update_available: bool = True
    notify_backup: bool = True
    notify_scheduled_restart: bool = True
    notify_admin_action: bool = True
    notify_resource: bool = True
    notify_system: bool = True
    created_at: datetime


class DiscordTestRequest(BaseModel):
    webhook_id: int | None = None
    message: str = "Dashboard connectivity test"


class DiscordAnnouncementRequest(BaseModel):
    title: str
    message: str
    event_type: str = "player"
