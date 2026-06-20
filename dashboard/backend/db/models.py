from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Float, Index, String, Text
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
    name: Mapped[str] = mapped_column(String(255), default="Operations Feed")
    url: Mapped[str] = mapped_column(Text(), unique=True)
    enabled: Mapped[bool] = mapped_column(default=True)
    notify_start: Mapped[bool] = mapped_column(default=True)
    notify_stop: Mapped[bool] = mapped_column(default=True)
    notify_crash: Mapped[bool] = mapped_column(default=True)
    notify_player_join: Mapped[bool] = mapped_column(default=False)
    notify_player_leave: Mapped[bool] = mapped_column(default=False)
    notify_update_available: Mapped[bool] = mapped_column(default=True)
    # Per-category system flags (split from the older notify_system umbrella).
    # Default True so existing webhooks keep getting these alerts on upgrade.
    notify_backup: Mapped[bool] = mapped_column(default=True)
    notify_scheduled_restart: Mapped[bool] = mapped_column(default=True)
    notify_admin_action: Mapped[bool] = mapped_column(default=True)
    notify_resource: Mapped[bool] = mapped_column(default=True)
    # Legacy umbrella flag kept for one-release back-compat. Migrations on
    # startup copy its value to the four flags above; new code reads only
    # the per-category flags. Safe to drop in a future release.
    notify_system: Mapped[bool] = mapped_column(default=True)
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


class MetricSnapshot(Base):
    __tablename__ = "metric_snapshot"
    __table_args__ = (Index("idx_metric_snapshot_timestamp", "timestamp"),)

    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True, index=True)
    cpu_percent: Mapped[float] = mapped_column(Float())
    memory_percent: Mapped[float] = mapped_column(Float())
    disk_percent: Mapped[float] = mapped_column(Float())
    mem_used_bytes: Mapped[float] = mapped_column(Float())
    mem_total_bytes: Mapped[float] = mapped_column(Float())
    disk_used_bytes: Mapped[float] = mapped_column(Float())
    disk_total_bytes: Mapped[float] = mapped_column(Float())
    net_sent_bps: Mapped[float] = mapped_column(Float(), default=0.0)
    net_recv_bps: Mapped[float] = mapped_column(Float(), default=0.0)
    disk_read_bps: Mapped[float] = mapped_column(Float(), default=0.0)
    disk_write_bps: Mapped[float] = mapped_column(Float(), default=0.0)
    load_avg_1: Mapped[float] = mapped_column(Float(), default=0.0)
    load_avg_5: Mapped[float] = mapped_column(Float(), default=0.0)
    load_avg_15: Mapped[float] = mapped_column(Float(), default=0.0)


class DashboardSetting(Base):
    __tablename__ = "dashboard_settings"

    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    value: Mapped[dict[str, Any] | None] = mapped_column(JSON(), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class ConnectionLog(Base):
    __tablename__ = "connection_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    steam_id: Mapped[str] = mapped_column(String(64), index=True)
    player_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    event: Mapped[str] = mapped_column(String(16), index=True)  # 'connect' or 'disconnect'
    map_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(32), default="admin")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    enabled: Mapped[bool] = mapped_column(default=True)


class WatchdogCrash(Base):
    """Forensic record of a container crash detected by the watchdog. Persisted
    so the crash history survives dashboard-api restarts (the in-memory ring
    buffer does not), letting operators re-inspect a burst after the fact and
    tell upstream Funcom/UE5 faults apart from our own config issues."""

    __tablename__ = "watchdog_crashes"
    __table_args__ = (Index("idx_watchdog_crashes_timestamp", "timestamp"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    service: Mapped[str] = mapped_column(String(255), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)
    # 'crash' (caught in exited/dead state), 'crash-loop', or 'high-rate'.
    kind: Mapped[str] = mapped_column(String(32), default="crash", index=True)
    exit_code: Mapped[int | None] = mapped_column(nullable=True)
    # Human label for the exit code, e.g. '139 SIGSEGV (segfault)'.
    exit_label: Mapped[str | None] = mapped_column(String(96), nullable=True)
    restarted: Mapped[bool] = mapped_column(default=False)
    # Crash count in the trailing hour (only set for 'high-rate' events).
    hourly_count: Mapped[int | None] = mapped_column(nullable=True)
    # Best-effort fault line scraped from the container logs.
    signature: Mapped[str | None] = mapped_column(Text(), nullable=True)
    message: Mapped[str | None] = mapped_column(Text(), nullable=True)
