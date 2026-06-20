from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from db.database import SessionLocal
from db.models import AuditLog
from services.announce_service import AnnounceService

logger = logging.getLogger(__name__)

_PERSIST_PATH = Path("/workspace/data/scheduled_announcements.json")
_DEFAULT_CHECK_INTERVAL_SECONDS = 30


class AnnounceScheduler:
    def __init__(self, announce_service: AnnounceService) -> None:
        self.announce_service = announce_service
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._wake_event = asyncio.Event()
        self._lock = asyncio.Lock()
        self._persist_path = _PERSIST_PATH if _PERSIST_PATH.exists() or _PERSIST_PATH.parent.exists() else None
        self._announcements: list[dict[str, Any]] = []
        self._load_announcements()

    async def start(self) -> None:
        if self._task is not None:
            return
        self._stop_event.clear()
        self._wake_event.clear()
        self._task = asyncio.create_task(self._run_loop(), name="announce-scheduler")
        logger.info("Announcement scheduler started (persisted=%s)", bool(self._persist_path))

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
        logger.info("Announcement scheduler stopped")

    def list_announcements(self) -> list[dict[str, Any]]:
        items = [dict(item) for item in self._announcements]
        return sorted(items, key=self._sort_key)

    async def create_announcement(
        self,
        *,
        message: str,
        sender: str | None = None,
        interval_minutes: int | None = None,
        run_at: datetime | None = None,
        enabled: bool = True,
    ) -> dict[str, Any]:
        clean_message = message.strip()
        if not clean_message:
            raise ValueError("message is required")
        self._validate_schedule(interval_minutes=interval_minutes, run_at=run_at)

        now = datetime.now(timezone.utc)
        announcement = {
            "id": uuid.uuid4().hex,
            "message": clean_message,
            "sender": self._normalize_sender(sender),
            "interval_minutes": interval_minutes,
            "next_run_at": self._serialize_datetime(run_at if run_at is not None else now + timedelta(minutes=interval_minutes or 0)),
            "enabled": bool(enabled),
            "one_shot": run_at is not None,
            "created_at": self._serialize_datetime(now),
        }
        if not announcement["enabled"] and not announcement["one_shot"]:
            announcement["next_run_at"] = self._serialize_datetime(now + timedelta(minutes=interval_minutes or 0))

        async with self._lock:
            self._announcements.append(announcement)
            self._persist_locked()
        self._wake_event.set()
        return dict(announcement)

    async def update_announcement(
        self,
        announcement_id: str,
        *,
        message: str | None = None,
        sender: str | None = None,
        interval_minutes: int | None = None,
        run_at: datetime | None = None,
        enabled: bool | None = None,
    ) -> dict[str, Any]:
        if interval_minutes is not None and run_at is not None:
            raise ValueError("Provide either interval_minutes or run_at, not both")

        async with self._lock:
            announcement = self._get_announcement_locked(announcement_id)
            now = datetime.now(timezone.utc)

            if message is not None:
                clean_message = message.strip()
                if not clean_message:
                    raise ValueError("message cannot be empty")
                announcement["message"] = clean_message
            if sender is not None:
                announcement["sender"] = self._normalize_sender(sender)

            if run_at is not None:
                announcement["one_shot"] = True
                announcement["interval_minutes"] = None
                announcement["next_run_at"] = self._serialize_datetime(run_at)
            elif interval_minutes is not None:
                if interval_minutes < 1:
                    raise ValueError("interval_minutes must be at least 1")
                announcement["one_shot"] = False
                announcement["interval_minutes"] = interval_minutes
                announcement["next_run_at"] = self._serialize_datetime(now + timedelta(minutes=interval_minutes))
            elif announcement["one_shot"] is False and not announcement.get("interval_minutes"):
                raise ValueError("Recurring announcements require interval_minutes")

            if enabled is not None:
                announcement["enabled"] = enabled
                if enabled:
                    if announcement["one_shot"]:
                        next_run = self._parse_datetime(announcement.get("next_run_at"))
                        if next_run is None or next_run <= now:
                            announcement["next_run_at"] = self._serialize_datetime(now)
                    else:
                        next_run = self._parse_datetime(announcement.get("next_run_at"))
                        interval = int(announcement.get("interval_minutes") or 0)
                        if interval < 1:
                            raise ValueError("Recurring announcements require interval_minutes")
                        if next_run is None or next_run <= now:
                            announcement["next_run_at"] = self._serialize_datetime(now + timedelta(minutes=interval))

            self._persist_locked()
            result = dict(announcement)

        self._wake_event.set()
        return result

    async def delete_announcement(self, announcement_id: str) -> None:
        async with self._lock:
            index = next((idx for idx, item in enumerate(self._announcements) if item["id"] == announcement_id), None)
            if index is None:
                raise KeyError(announcement_id)
            self._announcements.pop(index)
            self._persist_locked()
        self._wake_event.set()

    async def toggle_announcement(self, announcement_id: str, enabled: bool | None = None) -> dict[str, Any]:
        async with self._lock:
            announcement = self._get_announcement_locked(announcement_id)
            next_enabled = (not bool(announcement["enabled"])) if enabled is None else bool(enabled)
            announcement["enabled"] = next_enabled
            now = datetime.now(timezone.utc)
            if next_enabled:
                if announcement["one_shot"]:
                    next_run = self._parse_datetime(announcement.get("next_run_at"))
                    if next_run is None or next_run <= now:
                        announcement["next_run_at"] = self._serialize_datetime(now)
                else:
                    interval = int(announcement.get("interval_minutes") or 0)
                    if interval < 1:
                        raise ValueError("Recurring announcements require interval_minutes")
                    next_run = self._parse_datetime(announcement.get("next_run_at"))
                    if next_run is None or next_run <= now:
                        announcement["next_run_at"] = self._serialize_datetime(now + timedelta(minutes=interval))
            self._persist_locked()
            result = dict(announcement)
        self._wake_event.set()
        return result

    async def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await self._run_due_announcements()
            except Exception:
                logger.exception("Scheduled announcement loop failed")
            if self._stop_event.is_set():
                break
            await self._wait_for_change(_DEFAULT_CHECK_INTERVAL_SECONDS)

    async def _run_due_announcements(self) -> None:
        now = datetime.now(timezone.utc)
        async with self._lock:
            due_announcements = [
                dict(item)
                for item in self._announcements
                if item.get("enabled") and self._is_due(item, now)
            ]

        for item in due_announcements:
            message = item["message"]
            # Wisdom mode: pick a random quote from the pool
            if message == "__WISDOM__":
                from routers.announce import WISDOM_POOL
                message = WISDOM_POOL[hash(item["id"] + str(datetime.now(timezone.utc))) % len(WISDOM_POOL)]

            success = await asyncio.to_thread(
                self.announce_service.send_announcement,
                message,
                item.get("sender"),
            )
            await self._write_audit(item, success)

            async with self._lock:
                current = next((entry for entry in self._announcements if entry["id"] == item["id"]), None)
                if current is None:
                    continue

                if current.get("one_shot"):
                    current["enabled"] = False
                    current["next_run_at"] = None
                else:
                    interval_minutes = int(current.get("interval_minutes") or 0)
                    if interval_minutes < 1:
                        current["enabled"] = False
                        current["next_run_at"] = None
                    else:
                        next_run_at = self._parse_datetime(current.get("next_run_at")) or now
                        while next_run_at <= now:
                            next_run_at += timedelta(minutes=interval_minutes)
                        current["next_run_at"] = self._serialize_datetime(next_run_at)
                self._persist_locked()

    async def _write_audit(self, announcement: dict[str, Any], success: bool) -> None:
        async with SessionLocal() as session:
            session.add(
                AuditLog(
                    action="scheduled_announcement",
                    details={
                        "id": announcement["id"],
                        "message": announcement["message"],
                        "sender": announcement.get("sender"),
                        "one_shot": announcement.get("one_shot", False),
                        "success": success,
                        "executed_at": self._serialize_datetime(datetime.now(timezone.utc)),
                    },
                    performed_by="system",
                )
            )
            await session.commit()

    async def _wait_for_change(self, timeout_seconds: float) -> bool:
        try:
            await asyncio.wait_for(self._wake_event.wait(), timeout=max(timeout_seconds, 0))
            return True
        except asyncio.TimeoutError:
            return False
        finally:
            self._wake_event.clear()

    def _load_announcements(self) -> None:
        if self._persist_path is None or not self._persist_path.exists():
            return
        try:
            raw = json.loads(self._persist_path.read_text(encoding="utf-8"))
        except Exception:
            logger.exception("Failed to read scheduled announcements from %s", self._persist_path)
            return

        if not isinstance(raw, list):
            logger.warning("Ignoring invalid scheduled announcement payload in %s", self._persist_path)
            return

        loaded: list[dict[str, Any]] = []
        now = datetime.now(timezone.utc)
        for item in raw:
            if not isinstance(item, dict):
                continue
            message = str(item.get("message") or "").strip()
            if not message:
                continue
            one_shot = bool(item.get("one_shot", False))
            interval_minutes = item.get("interval_minutes")
            try:
                interval_value = int(interval_minutes) if interval_minutes is not None else None
            except (TypeError, ValueError):
                interval_value = None
            if not one_shot and (interval_value is None or interval_value < 1):
                continue

            enabled = bool(item.get("enabled", True))
            next_run = self._parse_datetime(item.get("next_run_at"))
            if next_run is None and enabled:
                if one_shot:
                    next_run = now
                else:
                    next_run = now + timedelta(minutes=interval_value or 1)

            loaded.append(
                {
                    "id": str(item.get("id") or uuid.uuid4().hex),
                    "message": message,
                    "sender": self._normalize_sender(item.get("sender")),
                    "interval_minutes": interval_value,
                    "next_run_at": self._serialize_datetime(next_run),
                    "enabled": enabled,
                    "one_shot": one_shot,
                    "created_at": self._serialize_datetime(self._parse_datetime(item.get("created_at")) or now),
                }
            )

        self._announcements = sorted(loaded, key=self._sort_key)

    def _persist_locked(self) -> None:
        if self._persist_path is None:
            return
        try:
            self._persist_path.write_text(
                json.dumps(self._announcements, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            logger.exception("Failed to persist scheduled announcements to %s", self._persist_path)

    def _get_announcement_locked(self, announcement_id: str) -> dict[str, Any]:
        announcement = next((item for item in self._announcements if item["id"] == announcement_id), None)
        if announcement is None:
            raise KeyError(announcement_id)
        return announcement

    def _validate_schedule(self, *, interval_minutes: int | None, run_at: datetime | None) -> None:
        if interval_minutes is not None and run_at is not None:
            raise ValueError("Provide either interval_minutes or run_at, not both")
        if interval_minutes is None and run_at is None:
            raise ValueError("Either interval_minutes or run_at is required")
        if interval_minutes is not None and interval_minutes < 1:
            raise ValueError("interval_minutes must be at least 1")

    def _is_due(self, announcement: dict[str, Any], now: datetime) -> bool:
        next_run_at = self._parse_datetime(announcement.get("next_run_at"))
        return next_run_at is not None and next_run_at <= now

    def _normalize_sender(self, sender: Any) -> str:
        if isinstance(sender, str) and sender.strip():
            return sender.strip()
        return self.announce_service.sender_name

    def _parse_datetime(self, value: Any) -> datetime | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            parsed = value
        else:
            try:
                parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            except ValueError:
                return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    def _serialize_datetime(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        normalized = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return normalized.astimezone(timezone.utc).isoformat()

    def _sort_key(self, item: dict[str, Any]) -> tuple[int, str, str]:
        next_run_at = item.get("next_run_at") or "9999-12-31T23:59:59+00:00"
        created_at = item.get("created_at") or "9999-12-31T23:59:59+00:00"
        return (0 if item.get("enabled") else 1, str(next_run_at), str(created_at))
