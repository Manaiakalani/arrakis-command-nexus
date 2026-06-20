from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from db.database import SessionLocal
from db.models import AuditLog
from services.announce_service import AnnounceService
from services.backup_service import BackupService
from services.docker_service import DockerService
from services.watchdog_service import WatchdogService

logger = logging.getLogger(__name__)


def _read_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def _serialize_datetime(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value else None


def _normalize_warning_minutes(values: list[int] | None) -> list[int]:
    if values is None:
        values = [15, 5, 1]
    normalized = {
        int(value)
        for value in values
        if isinstance(value, int) and int(value) > 0
    }
    return sorted(normalized, reverse=True)


class RestartScheduler:
    def __init__(
        self,
        announce_service: AnnounceService,
        backup_service: BackupService,
        docker_service: DockerService,
        watchdog_service: WatchdogService | None = None,
        discord_service: Any = None,
    ) -> None:
        self.announce_service = announce_service
        self.backup_service = backup_service
        self.docker_service = docker_service
        self.watchdog_service = watchdog_service
        self.discord_service = discord_service
        self.config_path = Path(os.getenv("RESTART_SCHEDULE_PATH", "/workspace/data/restart_schedule.json"))
        self.enabled = _read_bool("RESTART_SCHEDULE_ENABLED", False)
        self.interval_hours = max(1, int(os.getenv("RESTART_SCHEDULE_INTERVAL_HOURS", "24")))
        self.warning_minutes = _normalize_warning_minutes(self._read_warning_minutes_from_env())
        self.next_restart_at = _parse_datetime(os.getenv("RESTART_SCHEDULE_NEXT_RESTART_AT")) if self.enabled else None
        self.last_restart_at = _parse_datetime(os.getenv("RESTART_SCHEDULE_LAST_RESTART_AT"))
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()
        self._wake_event = asyncio.Event()
        self._lock = asyncio.Lock()
        self._restart_lock = asyncio.Lock()
        self._manual_task: asyncio.Task[None] | None = None
        self._sent_warnings: set[int] = set()
        self._load_settings_from_disk()
        self._normalize_state()
        self._persist_settings()

    async def start(self) -> None:
        if self._task is not None:
            return
        self._stop_event.clear()
        self._wake_event.clear()
        self._task = asyncio.create_task(self._run_loop(), name="restart-scheduler")
        logger.info(
            "Restart scheduler started (enabled=%s, interval_hours=%s, warning_minutes=%s)",
            self.enabled,
            self.interval_hours,
            self.warning_minutes,
        )

    async def stop(self) -> None:
        task = self._task
        manual_task = self._manual_task
        if task is None and manual_task is None:
            return
        self._stop_event.set()
        self._wake_event.set()
        if manual_task is not None:
            manual_task.cancel()
            try:
                await manual_task
            except asyncio.CancelledError:
                pass
            finally:
                self._manual_task = None
        if task is not None:
            try:
                await task
            finally:
                self._task = None
        logger.info("Restart scheduler stopped")

    def get_status(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "intervalHours": self.interval_hours,
            "warningMinutes": list(self.warning_minutes),
            "lastRestartAt": _serialize_datetime(self.last_restart_at),
            "nextRestartAt": _serialize_datetime(self.next_restart_at),
        }

    async def update_settings(
        self,
        *,
        enabled: bool | None = None,
        interval_hours: int | None = None,
        warning_minutes: list[int] | None = None,
    ) -> dict[str, object]:
        async with self._lock:
            schedule_changed = False
            if enabled is not None and enabled != self.enabled:
                self.enabled = enabled
                schedule_changed = True
            if interval_hours is not None:
                if interval_hours < 1:
                    raise ValueError("intervalHours must be at least 1.")
                if interval_hours != self.interval_hours:
                    self.interval_hours = interval_hours
                    schedule_changed = True
            if warning_minutes is not None:
                if any(minutes <= 0 for minutes in warning_minutes):
                    raise ValueError("warningMinutes must contain only positive whole numbers.")
                self.warning_minutes = _normalize_warning_minutes(warning_minutes)
            if self.enabled:
                if schedule_changed or self.next_restart_at is None:
                    self.next_restart_at = self._compute_next_restart()
            else:
                self.next_restart_at = None
            self._refresh_warning_state_locked()
            self._persist_settings()
        self._wake_event.set()
        logger.info(
            "Restart scheduler updated (enabled=%s, interval_hours=%s, warning_minutes=%s)",
            self.enabled,
            self.interval_hours,
            self.warning_minutes,
        )
        await self._write_audit_log(
            "restart_schedule_update",
            {
                "enabled": self.enabled,
                "interval_hours": self.interval_hours,
                "warning_minutes": self.warning_minutes,
            },
            performed_by="system",
        )
        return self.get_status()

    async def trigger_restart_now(self, warning_minutes: int = 0) -> dict[str, object]:
        warning_minutes = max(int(warning_minutes or 0), 0)
        if self._manual_task is not None and not self._manual_task.done():
            raise RuntimeError("A manual restart is already pending.")
        if warning_minutes <= 0:
            return await self._execute_restart(trigger="manual", warning_minutes=warning_minutes)

        services = await self._list_restart_targets()
        restart_at = datetime.now(timezone.utc) + timedelta(minutes=warning_minutes)
        message = self._warning_message(warning_minutes)
        announcement_sent = await asyncio.to_thread(self.announce_service.send_announcement, message)
        await self._write_audit_log(
            "scheduled_restart",
            {
                "event": "manual_warning",
                "warning_minutes": warning_minutes,
                "announcement_sent": announcement_sent,
                "restart_at": _serialize_datetime(restart_at),
                "services": services,
            },
            performed_by="system",
        )
        self._manual_task = asyncio.create_task(
            self._run_delayed_manual_restart(restart_at, warning_minutes),
            name="manual-restart-delay",
        )
        self._wake_event.set()
        return {
            "status": "ok",
            "trigger": "manual",
            "warningMinutes": warning_minutes,
            "startedAt": None,
            "restartAt": _serialize_datetime(restart_at),
            "services": services,
            "backupId": None,
            "backupError": None,
            "errors": {},
            "scheduled": True,
        }

    async def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            if self._manual_task is not None and not self._manual_task.done():
                await self._wait_for_change(15)
                continue

            await self._send_due_warnings()

            async with self._lock:
                enabled = self.enabled
                if enabled and self.next_restart_at is None:
                    self.next_restart_at = self._compute_next_restart()
                    self._refresh_warning_state_locked()
                    self._persist_settings()
                next_restart_at = self.next_restart_at

            if not enabled or next_restart_at is None:
                await self._wait_for_change(30)
                continue

            if datetime.now(timezone.utc) >= next_restart_at:
                await self._execute_restart(trigger="scheduled")
                continue

            delay_seconds = min(max((next_restart_at - datetime.now(timezone.utc)).total_seconds(), 1), 15)
            await self._wait_for_change(delay_seconds)

    async def _send_due_warnings(self) -> None:
        async with self._lock:
            if not self.enabled or self.next_restart_at is None:
                return
            now = datetime.now(timezone.utc)
            due_minutes = [
                minutes
                for minutes in self.warning_minutes
                if minutes not in self._sent_warnings
                and now >= self.next_restart_at - timedelta(minutes=minutes)
            ]
            if not due_minutes:
                return

        for minutes in due_minutes:
            message = self._warning_message(minutes)
            success = await asyncio.to_thread(self.announce_service.send_announcement, message)
            await self._write_audit_log(
                "scheduled_restart",
                {
                    "event": "warning",
                    "warning_minutes": minutes,
                    "announcement_sent": success,
                    "scheduled_for": _serialize_datetime(self.next_restart_at),
                },
                performed_by="system",
            )

        async with self._lock:
            self._sent_warnings.update(due_minutes)
            self._persist_settings()

    async def _run_delayed_manual_restart(self, restart_at: datetime, warning_minutes: int) -> None:
        try:
            delay_seconds = max((restart_at - datetime.now(timezone.utc)).total_seconds(), 0)
            if delay_seconds > 0:
                await asyncio.sleep(delay_seconds)
            await self._execute_restart(trigger="manual", warning_minutes=warning_minutes)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Delayed manual restart failed")
        finally:
            self._manual_task = None
            self._wake_event.set()

    async def _execute_restart(self, *, trigger: str, warning_minutes: int = 0) -> dict[str, object]:
        async with self._restart_lock:
            restart_started_at = datetime.now(timezone.utc)
            services = await self._list_restart_targets()
            backup_id: str | None = None
            backup_error: str | None = None
            restarted_services: list[str] = []
            restart_errors: dict[str, str] = {}

            await self._write_audit_log(
                "scheduled_restart",
                {
                    "event": "starting",
                    "trigger": trigger,
                    "warning_minutes": warning_minutes,
                    "services": services,
                },
                performed_by="system",
            )

            try:
                await asyncio.to_thread(
                    self.announce_service.send_announcement,
                    "Server restart starting now. A backup is being created before services restart.",
                )
            except Exception:
                logger.exception("Failed to send restart-started announcement")

            try:
                backup = await self.backup_service.create_backup(scope="full")
                backup_id = backup.id
            except Exception as exc:  # noqa: BLE001
                backup_error = str(exc)
                logger.exception("Pre-restart backup failed")

            for service in services:
                try:
                    if self.watchdog_service is not None and self.watchdog_service._is_monitored_service(service):
                        await self.watchdog_service.restart_service(service)
                    else:
                        await self.docker_service.restart_container(service)
                    restarted_services.append(service)
                except Exception as exc:  # noqa: BLE001
                    restart_errors[service] = str(exc)
                    logger.exception("Scheduled restart failed for service %s", service)

            finished_at = datetime.now(timezone.utc)
            async with self._lock:
                self.last_restart_at = finished_at
                self.next_restart_at = finished_at + timedelta(hours=self.interval_hours) if self.enabled else None
                self._sent_warnings.clear()
                self._refresh_warning_state_locked(now=finished_at)
                self._persist_settings()

            status = "ok"
            if backup_error or restart_errors:
                status = "partial" if restarted_services else "failed"

            payload = {
                "status": status,
                "trigger": trigger,
                "warningMinutes": warning_minutes,
                "restartAt": _serialize_datetime(finished_at),
                "startedAt": _serialize_datetime(restart_started_at),
                "services": restarted_services,
                "backupId": backup_id,
                "backupError": backup_error,
                "errors": restart_errors,
            }
            await self._write_audit_log(
                "scheduled_restart",
                {"event": "completed", **payload},
                performed_by="system",
            )

            if not restarted_services:
                raise RuntimeError("No server containers were restarted.")
            if restart_errors:
                raise RuntimeError(
                    "Failed to restart one or more services: "
                    + ", ".join(f"{service} ({message})" for service, message in restart_errors.items())
                )
            return payload

    async def _list_restart_targets(self) -> list[str]:
        targets = sorted({map_status.name for map_status in await self.docker_service.list_map_statuses() if map_status.name})
        if not targets:
            raise RuntimeError("No map services are available for restart.")
        return targets

    async def _wait_for_change(self, timeout_seconds: float) -> bool:
        try:
            await asyncio.wait_for(self._wake_event.wait(), timeout=max(timeout_seconds, 0))
            return True
        except asyncio.TimeoutError:
            return False
        finally:
            self._wake_event.clear()

    async def _write_audit_log(self, action: str, details: dict[str, Any], *, performed_by: str) -> None:
        try:
            async with SessionLocal() as session:
                session.add(AuditLog(action=action, details=details, performed_by=performed_by))
                await session.commit()
        except Exception:
            logger.exception("Failed to write audit log action=%s", action)
        # Mirror scheduled_restart events to Discord (notify_system flag) so
        # operators see warnings + start/finish notifications without polling.
        if action == "scheduled_restart" and self.discord_service is not None:
            try:
                await self.discord_service.enqueue(
                    "scheduled_restart",
                    self._format_restart_discord(details),
                    title=self._restart_discord_title(details),
                )
            except Exception:
                logger.exception("Failed to enqueue Discord scheduled_restart notification")

    @staticmethod
    def _restart_discord_title(details: dict[str, Any]) -> str:
        event = details.get("event", "")
        if event == "warning" or event == "manual_warning":
            return "⏰ Restart Scheduled"
        if event == "starting":
            return "🔄 Restart Starting"
        if event == "completed":
            return "✅ Restart Complete"
        if event == "failed":
            return "❌ Restart Failed"
        return "🔧 Scheduled Restart"

    @staticmethod
    def _format_restart_discord(details: dict[str, Any]) -> str:
        event = details.get("event", "")
        if event in {"warning", "manual_warning"}:
            mins = details.get("warning_minutes", 0)
            sched = details.get("scheduled_for") or details.get("restart_at") or "soon"
            return (
                f"Server restart in **{mins} minute(s)**.\n"
                f"Scheduled for: `{sched}`\n"
                f"Players have been notified in-game."
            )
        if event == "starting":
            services = details.get("services") or []
            trigger = details.get("trigger", "scheduled")
            return f"Trigger: `{trigger}`\nServices restarting: {', '.join(services) if services else '(none listed)'}"
        if event == "completed":
            services = details.get("restarted") or details.get("services") or []
            backup = details.get("backup_id")
            backup_line = f"\nBackup: `{backup}`" if backup else ""
            return f"Restarted: {', '.join(services) if services else '(none)'}{backup_line}"
        if event == "failed":
            return f"Error: `{details.get('error', 'unknown')}`"
        return f"Event: `{event}` — {details}"

    def _compute_next_restart(self) -> datetime:
        return datetime.now(timezone.utc) + timedelta(hours=self.interval_hours)

    def _load_settings_from_disk(self) -> None:
        if not self.config_path.exists():
            return
        try:
            payload = json.loads(self.config_path.read_text(encoding="utf-8"))
        except Exception:
            logger.exception("Failed to read restart schedule configuration from %s", self.config_path)
            return

        self.enabled = bool(payload.get("enabled", self.enabled))
        self.interval_hours = max(1, int(payload.get("interval_hours", self.interval_hours)))
        self.warning_minutes = _normalize_warning_minutes(payload.get("warning_minutes", self.warning_minutes))
        self.next_restart_at = _parse_datetime(payload.get("next_restart_at")) if self.enabled else None
        self.last_restart_at = _parse_datetime(payload.get("last_restart_at"))

    def _persist_settings(self) -> None:
        os.environ["RESTART_SCHEDULE_ENABLED"] = "true" if self.enabled else "false"
        os.environ["RESTART_SCHEDULE_INTERVAL_HOURS"] = str(self.interval_hours)
        os.environ["RESTART_SCHEDULE_WARNING_MINUTES"] = ",".join(str(minutes) for minutes in self.warning_minutes)
        if self.next_restart_at is not None:
            os.environ["RESTART_SCHEDULE_NEXT_RESTART_AT"] = self.next_restart_at.isoformat()
        else:
            os.environ.pop("RESTART_SCHEDULE_NEXT_RESTART_AT", None)
        if self.last_restart_at is not None:
            os.environ["RESTART_SCHEDULE_LAST_RESTART_AT"] = self.last_restart_at.isoformat()
        else:
            os.environ.pop("RESTART_SCHEDULE_LAST_RESTART_AT", None)

        payload = {
            "enabled": self.enabled,
            "interval_hours": self.interval_hours,
            "next_restart_at": _serialize_datetime(self.next_restart_at),
            "last_restart_at": _serialize_datetime(self.last_restart_at),
            "warning_minutes": self.warning_minutes,
        }
        try:
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            self.config_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except Exception:
            logger.exception("Failed to persist restart schedule configuration to %s", self.config_path)

    def _normalize_state(self) -> None:
        self.warning_minutes = _normalize_warning_minutes(self.warning_minutes)
        if self.interval_hours < 1:
            self.interval_hours = 24
        if not self.enabled:
            self.next_restart_at = None
            self._sent_warnings.clear()
            return
        now = datetime.now(timezone.utc)
        if self.next_restart_at is None or self.next_restart_at <= now:
            self.next_restart_at = self._compute_next_restart()
        self._refresh_warning_state_locked(now=now)

    def _refresh_warning_state_locked(self, now: datetime | None = None) -> None:
        if not self.enabled or self.next_restart_at is None:
            self._sent_warnings.clear()
            return
        reference = now or datetime.now(timezone.utc)
        self._sent_warnings = {
            minutes
            for minutes in self.warning_minutes
            if reference >= self.next_restart_at - timedelta(minutes=minutes)
        }

    def _warning_message(self, minutes: int) -> str:
        unit = "minute" if minutes == 1 else "minutes"
        return f"Server will restart in {minutes} {unit}. Please find a safe location."

    def _read_warning_minutes_from_env(self) -> list[int] | None:
        raw = os.getenv("RESTART_SCHEDULE_WARNING_MINUTES")
        if raw is None:
            return None
        values: list[int] = []
        for part in raw.split(","):
            stripped = part.strip()
            if not stripped:
                continue
            try:
                values.append(int(stripped))
            except ValueError:
                logger.warning("Ignoring invalid restart warning minute value: %s", stripped)
        return values
