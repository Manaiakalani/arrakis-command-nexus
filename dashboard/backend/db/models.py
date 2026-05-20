from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, String, Text
from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(AsyncAttrs, DeclarativeBase):
    pass


class BannedPlayer(Base):
    __tablename__ = "banned_players"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    steam_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    player_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reason: Mapped[str] = mapped_column(Text())
    banned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    banned_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    banned_by: Mapped[str] = mapped_column(String(255), default="dashboard")


class AllowlistedPlayer(Base):
    __tablename__ = "allowlisted_players"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    steam_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    player_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class DiscordWebhook(Base):
    __tablename__ = "discord_webhooks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    url: Mapped[str] = mapped_column(Text(), unique=True)
    notify_start: Mapped[bool] = mapped_column(default=True)
    notify_stop: Mapped[bool] = mapped_column(default=True)
    notify_crash: Mapped[bool] = mapped_column(default=True)
    notify_player_join: Mapped[bool] = mapped_column(default=False)
    notify_player_leave: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class ConfigBackup(Base):
    __tablename__ = "config_backups"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(String(255), index=True)
    config_type: Mapped[str] = mapped_column(String(255), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    content: Mapped[dict[str, Any]] = mapped_column(JSON())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    action: Mapped[str] = mapped_column(String(255), index=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSON())
    performed_by: Mapped[str] = mapped_column(String(255), default="dashboard")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
