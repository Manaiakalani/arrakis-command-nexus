from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from services.backup_service import BackupService

logger = logging.getLogger(__name__)

_PERSIST_PATH = Path("/workspace/config/backup_schedule.json")


def _read_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class BackupScheduler:
    def __init__(self, backup_service: BackupService) -> None:
        self.backup_service = backup_service
        self._persist_path = _PERSIST_PATH if _PERSIST_PATH.parent.exists() else None

        # Load persisted settings first, fall back to env vars
        saved = self._load_settings()
        self.enabled = saved.get("enabled", _read_bool("BACKUP_SCHEDULE_ENABLED", False))
        self.interval_hours = max(1, saved.get("interval_hours", int(os.getenv("BACKUP_SCHEDULE_INTERVAL_HOURS", "24"))))
        self.retention_days = max(0, saved.get("retention_days", int(os.getenv("BACKUP_RETENTION_DAYS", "7"))))
        self.last_run_at: datetime | None = None
        last_run_str = saved.get("last_run_at")
        if last_run_str:
            try:
                self.last_run_at = datetime.fromisoformat(last_run_str)
            except (ValueError, TypeError):
                pass
        self.next_run_at: datetime | None = self._compute_next_run() if self.enabled else None
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._wake_event = asyncio.Event()
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if self._task is not None:
            return
        self._stop_event.clear()
        self._wake_event.clear()
        self._task = asyncio.create_task(self._run_loop(), name="backup-scheduler")
        logger.info(
            "Backup scheduler started (enabled=%s, interval_hours=%s, retention_days=%s)",
            self.enabled,
            self.interval_hours,
            self.retention_days,
        )

    async def stop(self) -> None:
        task = self._task
        if task is None:
            return
        self._stop_event.set()
        self._wake_event.set()
        try:
            await task
        finally:
            self._task = None
        logger.info("Backup scheduler stopped")

    def get_status(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "intervalHours": self.interval_hours,
            "retentionDays": self.retention_days,
            "lastRunAt": self.last_run_at.isoformat() if self.last_run_at else None,
            "nextRunAt": self.next_run_at.isoformat() if self.next_run_at else None,
        }

    async def update_settings(
        self,
        *,
        enabled: bool | None = None,
        interval_hours: int | None = None,
        retention_days: int | None = None,
    ) -> dict[str, object]:
        async with self._lock:
            if enabled is not None:
                self.enabled = enabled
            if interval_hours is not None:
                if interval_hours < 1:
                    raise ValueError("intervalHours must be at least 1.")
                self.interval_hours = interval_hours
            if retention_days is not None:
                if retention_days < 0:
                    raise ValueError("retentionDays must be 0 or greater.")
                self.retention_days = retention_days
            self.next_run_at = self._compute_next_run() if self.enabled else None
            self._persist_settings()
        self._wake_event.set()
        logger.info(
            "Backup scheduler updated (enabled=%s, interval_hours=%s, retention_days=%s)",
            self.enabled,
            self.interval_hours,
            self.retention_days,
        )
        return self.get_status()

    async def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            async with self._lock:
                enabled = self.enabled
                if enabled and self.next_run_at is None:
                    self.next_run_at = self._compute_next_run()
                next_run_at = self.next_run_at

            if not enabled:
                await self._wait_for_change(60)
                continue

            if next_run_at is None:
                await self._wait_for_change(60)
                continue

            delay_seconds = (next_run_at - datetime.now(timezone.utc)).total_seconds()
            if delay_seconds > 0:
                if await self._wait_for_change(delay_seconds):
                    continue

            if self._stop_event.is_set():
                break

            await self._run_scheduled_backup()

    async def _run_scheduled_backup(self) -> None:
        async with self._lock:
            retention_days = self.retention_days
            interval_hours = self.interval_hours

        started_at = datetime.now(timezone.utc)
        logger.info("Starting scheduled backup at %s", started_at.isoformat())
        try:
            backup = await self.backup_service.create_backup(scope="full")
            deleted_count = await self.backup_service.prune_old_backups(retention_days)
            finished_at = datetime.now(timezone.utc)
            async with self._lock:
                self.last_run_at = finished_at
                self.next_run_at = finished_at + timedelta(hours=interval_hours) if self.enabled else None
                self._persist_settings()
            logger.info(
                "Scheduled backup completed (backup_id=%s, pruned=%s)",
                backup.id,
                deleted_count,
            )
        except Exception:
            logger.exception("Scheduled backup failed")
            async with self._lock:
                self.next_run_at = datetime.now(timezone.utc) + timedelta(hours=interval_hours) if self.enabled else None
                self._persist_settings()

    async def _wait_for_change(self, timeout_seconds: float) -> bool:
        try:
            await asyncio.wait_for(self._wake_event.wait(), timeout=max(timeout_seconds, 0))
            return True
        except asyncio.TimeoutError:
            return False
        finally:
            self._wake_event.clear()

    def _compute_next_run(self) -> datetime:
        return datetime.now(timezone.utc) + timedelta(hours=self.interval_hours)

    def _load_settings(self) -> dict:
        """Load persisted settings from JSON file."""
        if self._persist_path is None or not self._persist_path.exists():
            return {}
        try:
            data = json.loads(self._persist_path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                logger.info("Loaded backup schedule from %s", self._persist_path)
                return data
        except Exception:
            logger.warning("Failed to read backup schedule from %s", self._persist_path)
        return {}

    def _persist_settings(self) -> None:
        """Persist current settings to JSON file so they survive restarts."""
        if self._persist_path is None:
            return
        try:
            data = {
                "enabled": self.enabled,
                "interval_hours": self.interval_hours,
                "retention_days": self.retention_days,
                "last_run_at": self.last_run_at.isoformat() if self.last_run_at else None,
            }
            self._persist_path.write_text(
                json.dumps(data, indent=2), encoding="utf-8"
            )
        except Exception:
            logger.exception("Failed to persist backup schedule to %s", self._persist_path)
