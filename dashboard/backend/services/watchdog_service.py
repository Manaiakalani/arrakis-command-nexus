from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from docker.errors import DockerException, NotFound

logger = logging.getLogger(__name__)


def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(slots=True)
class CrashEvent:
    service: str
    timestamp: datetime
    exit_code: int | None
    restarted: bool
    message: str


@dataclass(slots=True)
class ContainerSnapshot:
    service: str
    status: str
    exit_code: int | None
    restart_count: int


class WatchdogService:
    def __init__(self, docker_service, discord_service) -> None:
        self.docker_service = docker_service
        self.discord_service = discord_service
        self.enabled = _env_flag("WATCHDOG_ENABLED", True)
        self.auto_restart = _env_flag("WATCHDOG_AUTO_RESTART", True)
        self.interval_seconds = max(int(os.getenv("WATCHDOG_INTERVAL", "30")), 5)
        self._task: asyncio.Task[None] | None = None
        self._known_states: dict[str, ContainerSnapshot] = {}
        self._crash_history: deque[CrashEvent] = deque(maxlen=100)
        self._suppressed_restart_counts: dict[str, int] = {}
        self._monitored_container_count = 0

    async def start(self) -> None:
        if not self.enabled or self._task is not None:
            return
        self._task = asyncio.create_task(self._watch_loop(), name="watchdog-service")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    def get_status(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "autoRestart": self.auto_restart,
            "intervalSeconds": self.interval_seconds,
            "monitoredContainers": self._monitored_container_count,
        }

    def get_crashes(self) -> list[dict[str, Any]]:
        return [self._to_crash_dict(event) for event in reversed(self._crash_history)]

    async def restart_service(self, service: str) -> dict[str, Any]:
        snapshot = await self._inspect_container(service)
        if snapshot is None or not self._is_monitored_service(service):
            raise LookupError(f"Monitored service '{service}' not found")
        restarted = await self._restart_container(service, expected_restart_count=snapshot.restart_count)
        if not restarted:
            raise RuntimeError(f"Could not restart monitored service '{service}'")
        return {"status": "ok", "service": service, "restarted": True}

    async def _watch_loop(self) -> None:
        while True:
            try:
                await self._poll_once()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Watchdog polling failed: %s", exc)
            await asyncio.sleep(self.interval_seconds)

    async def _poll_once(self) -> None:
        snapshots = await self._list_monitored_snapshots()
        self._monitored_container_count = len(snapshots)
        active_services = {snapshot.service for snapshot in snapshots}
        self._known_states = {
            service: snapshot for service, snapshot in self._known_states.items() if service in active_services
        }
        self._suppressed_restart_counts = {
            service: expected
            for service, expected in self._suppressed_restart_counts.items()
            if service in active_services
        }

        for snapshot in snapshots:
            previous = self._known_states.get(snapshot.service)
            crash_detected, message = self._detect_crash(snapshot, previous)
            restarted = False
            if crash_detected:
                if self.auto_restart and snapshot.status != "running":
                    restarted = await self._restart_container(snapshot.service, expected_restart_count=snapshot.restart_count)
                    if restarted:
                        message = f"{message} Watchdog restarted the container."
                    else:
                        message = f"{message} Watchdog restart failed."
                event = CrashEvent(
                    service=snapshot.service,
                    timestamp=datetime.now(timezone.utc),
                    exit_code=snapshot.exit_code,
                    restarted=restarted,
                    message=message,
                )
                self._crash_history.append(event)
                logger.warning(message)
                await self.discord_service.enqueue("crash", message, title=f"Watchdog crash detected: {snapshot.service}")
            self._known_states[snapshot.service] = snapshot

    def _detect_crash(self, snapshot: ContainerSnapshot, previous: ContainerSnapshot | None) -> tuple[bool, str]:
        suppressed_restart = self._suppressed_restart_counts.get(snapshot.service)
        if suppressed_restart is not None and snapshot.restart_count >= suppressed_restart:
            self._suppressed_restart_counts.pop(snapshot.service, None)
            return False, ""

        if previous is None:
            if self._is_unexpected_exit(snapshot):
                return True, self._build_message(snapshot, None, include_restart_delta=False)
            return False, ""

        restart_increased = snapshot.restart_count > previous.restart_count
        unexpected_exit = self._is_unexpected_exit(snapshot) and (
            previous.status != snapshot.status or previous.exit_code != snapshot.exit_code
        )

        if not restart_increased and not unexpected_exit:
            return False, ""

        return True, self._build_message(snapshot, previous, include_restart_delta=restart_increased)

    def _build_message(
        self,
        snapshot: ContainerSnapshot,
        previous: ContainerSnapshot | None,
        *,
        include_restart_delta: bool,
    ) -> str:
        parts = [f"Crash detected for {snapshot.service}."]
        if snapshot.exit_code is not None:
            parts.append(f"Exit code: {snapshot.exit_code}.")
        if include_restart_delta:
            before = previous.restart_count if previous else 0
            parts.append(f"Restart count increased from {before} to {snapshot.restart_count}.")
        parts.append(f"Current status: {snapshot.status}.")
        return " ".join(parts)

    def _is_unexpected_exit(self, snapshot: ContainerSnapshot) -> bool:
        return snapshot.status in {"exited", "dead"} and snapshot.exit_code not in {None, 0}

    def _is_monitored_service(self, service_name: str) -> bool:
        return self.docker_service._map_role(service_name) in {"overmap", "survival"}

    async def _restart_container(self, service: str, *, expected_restart_count: int) -> bool:
        try:
            self._suppressed_restart_counts[service] = expected_restart_count + 1
            container = await asyncio.to_thread(self.docker_service.client.containers.get, service)
            await asyncio.to_thread(container.restart)
            return True
        except (AttributeError, DockerException, NotFound) as exc:
            logger.warning("Watchdog could not restart %s: %s", service, exc)
            self._suppressed_restart_counts.pop(service, None)
            return False

    async def _inspect_container(self, service: str) -> ContainerSnapshot | None:
        if not self.docker_service.client:
            return None

        def _load() -> ContainerSnapshot | None:
            try:
                container = self.docker_service.client.containers.get(service)
            except NotFound:
                return None
            container.reload()
            return self._snapshot_from_container(container)

        return await asyncio.to_thread(_load)

    async def _list_monitored_snapshots(self) -> list[ContainerSnapshot]:
        if not self.enabled or not self.docker_service.client:
            return []

        def _load() -> list[ContainerSnapshot]:
            containers = self.docker_service.client.containers.list(
                all=True,
                filters={"label": f"com.docker.compose.project={self.docker_service.compose_project}"},
            )
            snapshots: list[ContainerSnapshot] = []
            for container in containers:
                if not self._is_monitored_service(container.name):
                    continue
                container.reload()
                snapshots.append(self._snapshot_from_container(container))
            return snapshots

        return await asyncio.to_thread(_load)

    def _snapshot_from_container(self, container) -> ContainerSnapshot:
        attrs = container.attrs or {}
        state = attrs.get("State", {})
        restart_count = attrs.get("RestartCount", 0)
        try:
            restart_count = int(restart_count or 0)
        except (TypeError, ValueError):
            restart_count = 0
        exit_code = state.get("ExitCode")
        try:
            exit_code = None if exit_code is None else int(exit_code)
        except (TypeError, ValueError):
            exit_code = None
        status = str(state.get("Status") or container.status or "unknown")
        return ContainerSnapshot(
            service=container.name,
            status=status,
            exit_code=exit_code,
            restart_count=restart_count,
        )

    def _to_crash_dict(self, event: CrashEvent) -> dict[str, Any]:
        return {
            "service": event.service,
            "timestamp": event.timestamp.isoformat(),
            "exitCode": event.exit_code,
            "restarted": event.restarted,
            "message": event.message,
        }
