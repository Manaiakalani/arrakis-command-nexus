from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from docker.errors import DockerException, NotFound

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Crash-loop and resource-pressure thresholds
# ---------------------------------------------------------------------------
CRASH_LOOP_THRESHOLD = int(os.getenv("WATCHDOG_CRASH_LOOP_THRESHOLD", "10"))
"""Restart delta per poll that triggers a crash-loop alert."""

CRASH_LOOP_RATE_WINDOW = int(os.getenv("WATCHDOG_CRASH_LOOP_RATE_WINDOW", "10"))
"""Number of polls to look back when calculating restart velocity."""

CRASH_LOOP_RATE_THRESHOLD = int(os.getenv("WATCHDOG_CRASH_LOOP_RATE_THRESHOLD", "30"))
"""If total restart delta over the rate window exceeds this, alert."""

RESOURCE_MEM_WARN_PCT = float(os.getenv("WATCHDOG_MEM_WARN_PCT", "85"))
"""Memory usage percentage that triggers a warning."""

RESOURCE_CPU_WARN_PCT = float(os.getenv("WATCHDOG_CPU_WARN_PCT", "150"))
"""CPU usage percentage that triggers a warning (>100% = multiple cores)."""


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
    oom_killed: bool = False


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
        # Crash-loop velocity tracking: ring buffer of restart counts per service
        self._restart_history: dict[str, deque[int]] = {}
        # Cooldown: avoid spamming the same alert type per service
        self._alert_cooldowns: dict[str, datetime] = {}
        self._alert_cooldown_seconds = int(os.getenv("WATCHDOG_ALERT_COOLDOWN", "300"))

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
        # Build crash-loop status for any services with active velocity tracking
        crash_loops: dict[str, Any] = {}
        for service, history in self._restart_history.items():
            window_total = sum(history)
            if window_total > 0:
                crash_loops[service] = {
                    "restartsInWindow": window_total,
                    "windowSize": len(history),
                    "isLooping": window_total >= CRASH_LOOP_RATE_THRESHOLD,
                }
        return {
            "enabled": self.enabled,
            "autoRestart": self.auto_restart,
            "intervalSeconds": self.interval_seconds,
            "monitoredContainers": self._monitored_container_count,
            "crashLoops": crash_loops,
        }

    def get_crashes(self) -> list[dict[str, Any]]:
        return [self._to_crash_dict(event) for event in reversed(self._crash_history)]

    async def restart_service(self, service: str) -> dict[str, Any]:
        self.docker_service.validate_container_name(service)
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
            if previous is not None and not crash_detected:
                self._log_unusual_restart(snapshot, previous)
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

        # Check resource pressure every poll cycle
        await self._check_resource_pressure()

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

        # If the container is running with exit code 0, Docker's internal
        # restart count can increment due to policy restarts (e.g. OOM or
        # graceful reload).  Don't flag these as crashes.
        if restart_increased and snapshot.status == "running" and snapshot.exit_code == 0:
            return False, ""

        if not restart_increased and not unexpected_exit:
            return False, ""

        return True, self._build_message(snapshot, previous, include_restart_delta=restart_increased)

    def _log_unusual_restart(self, snapshot: ContainerSnapshot, previous: ContainerSnapshot) -> None:
        if snapshot.restart_count <= previous.restart_count:
            return
        delta = snapshot.restart_count - previous.restart_count

        # Track restart velocity in a ring buffer
        if snapshot.service not in self._restart_history:
            self._restart_history[snapshot.service] = deque(maxlen=CRASH_LOOP_RATE_WINDOW)
        self._restart_history[snapshot.service].append(delta)

        # Calculate total restarts over the sliding window
        window_total = sum(self._restart_history[snapshot.service])

        # Detect crash-loop: either a sudden large jump or sustained high velocity
        is_crash_loop = delta >= CRASH_LOOP_THRESHOLD or window_total >= CRASH_LOOP_RATE_THRESHOLD
        if is_crash_loop:
            asyncio.create_task(self._alert_crash_loop(snapshot, previous, delta, window_total))
        elif previous.restart_count <= 20 or delta >= 10:
            # Still log unusual restarts for containers not yet in crash-loop
            logger.warning(
                "Restart count increased for %s from %s to %s (status=%s, exit_code=%s)",
                snapshot.service,
                previous.restart_count,
                snapshot.restart_count,
                snapshot.status,
                snapshot.exit_code,
            )

    async def _alert_crash_loop(
        self,
        snapshot: ContainerSnapshot,
        previous: ContainerSnapshot,
        delta: int,
        window_total: int,
    ) -> None:
        """Send a crash-loop alert with cooldown to avoid spam."""
        cooldown_key = f"crash-loop:{snapshot.service}"
        now = datetime.now(timezone.utc)
        last_alert = self._alert_cooldowns.get(cooldown_key)
        if last_alert and (now - last_alert).total_seconds() < self._alert_cooldown_seconds:
            return

        self._alert_cooldowns[cooldown_key] = now
        msg = (
            f"Crash-loop detected for {snapshot.service}. "
            f"Restart count: {snapshot.restart_count} (+{delta} since last poll, "
            f"+{window_total} over last {len(self._restart_history.get(snapshot.service, []))} polls). "
            f"Rapid restart loops waste CPU/memory and can degrade other services "
            f"(e.g. crafting timer glitches from tick-rate drops)."
        )
        logger.warning(msg)
        event = CrashEvent(
            service=snapshot.service,
            timestamp=now,
            exit_code=snapshot.exit_code,
            restarted=False,
            message=msg,
        )
        self._crash_history.append(event)
        await self.discord_service.enqueue(
            "crash", msg, title=f"Crash-loop: {snapshot.service}"
        )

    async def _check_resource_pressure(self) -> None:
        """Check CPU and memory usage of monitored containers via Docker stats."""
        if not self.docker_service.client:
            return

        def _collect_stats() -> list[dict[str, Any]]:
            results = []
            try:
                containers = self.docker_service.client.containers.list(
                    filters={"label": f"com.docker.compose.project={self.docker_service.compose_project}"},
                )
            except (DockerException, AttributeError):
                return results
            for container in containers:
                if not self._is_monitored_service(container.name):
                    continue
                try:
                    stats = container.stats(stream=False)
                except (DockerException, NotFound):
                    continue
                cpu_pct = self._calc_cpu_percent(stats)
                mem_pct, mem_used_mb = self._calc_mem_usage(stats)
                results.append({
                    "service": container.name,
                    "cpu_pct": cpu_pct,
                    "mem_pct": mem_pct,
                    "mem_used_mb": mem_used_mb,
                })
            return results

        try:
            stats_list = await asyncio.to_thread(_collect_stats)
        except Exception:  # noqa: BLE001
            return

        now = datetime.now(timezone.utc)
        for entry in stats_list:
            service = entry["service"]
            # Memory pressure alert
            if entry["mem_pct"] >= RESOURCE_MEM_WARN_PCT:
                cooldown_key = f"mem-pressure:{service}"
                last_alert = self._alert_cooldowns.get(cooldown_key)
                if not last_alert or (now - last_alert).total_seconds() >= self._alert_cooldown_seconds:
                    self._alert_cooldowns[cooldown_key] = now
                    msg = (
                        f"Memory pressure on {service}: {entry['mem_pct']:.1f}% "
                        f"({entry['mem_used_mb']:.0f} MB used). "
                        f"High memory usage can cause tick-rate drops and gameplay glitches. "
                        f"Consider increasing MEM_LIMIT in .env."
                    )
                    logger.warning(msg)
                    await self.discord_service.enqueue("resource", msg, title=f"Memory pressure: {service}")

            # CPU pressure alert
            if entry["cpu_pct"] >= RESOURCE_CPU_WARN_PCT:
                cooldown_key = f"cpu-pressure:{service}"
                last_alert = self._alert_cooldowns.get(cooldown_key)
                if not last_alert or (now - last_alert).total_seconds() >= self._alert_cooldown_seconds:
                    self._alert_cooldowns[cooldown_key] = now
                    msg = (
                        f"CPU pressure on {service}: {entry['cpu_pct']:.1f}%. "
                        f"Sustained high CPU can cause tick-rate drops and gameplay glitches."
                    )
                    logger.warning(msg)
                    await self.discord_service.enqueue("resource", msg, title=f"CPU pressure: {service}")

    @staticmethod
    def _calc_cpu_percent(stats: dict) -> float:
        """Calculate CPU percentage from Docker stats JSON."""
        try:
            cpu_stats = stats.get("cpu_stats", {})
            precpu_stats = stats.get("precpu_stats", {})
            cpu_delta = cpu_stats.get("cpu_usage", {}).get("total_usage", 0) - precpu_stats.get("cpu_usage", {}).get("total_usage", 0)
            system_delta = cpu_stats.get("system_cpu_usage", 0) - precpu_stats.get("system_cpu_usage", 0)
            num_cpus = len(cpu_stats.get("cpu_usage", {}).get("percpu_usage", [])) or cpu_stats.get("online_cpus", 1)
            if system_delta > 0 and cpu_delta >= 0:
                return (cpu_delta / system_delta) * num_cpus * 100.0
        except (TypeError, ValueError, ZeroDivisionError):
            pass
        return 0.0

    @staticmethod
    def _calc_mem_usage(stats: dict) -> tuple[float, float]:
        """Return (percentage, used_mb) from Docker stats JSON."""
        try:
            mem = stats.get("memory_stats", {})
            usage = mem.get("usage", 0)
            limit = mem.get("limit", 0)
            cache = mem.get("stats", {}).get("cache", 0)
            used = usage - cache
            if limit > 0:
                return (used / limit) * 100.0, used / (1024 * 1024)
        except (TypeError, ValueError, ZeroDivisionError):
            pass
        return 0.0, 0.0

    def _build_message(
        self,
        snapshot: ContainerSnapshot,
        previous: ContainerSnapshot | None,
        *,
        include_restart_delta: bool,
    ) -> str:
        parts = [f"Crash detected for {snapshot.service}."]
        if snapshot.oom_killed:
            parts.append("Container was OOM-killed (out of memory). Consider increasing MEM_LIMIT in .env or running host-tuning.sh --swap.")
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
        try:
            self.docker_service.validate_container_name(service_name)
        except ValueError:
            return False
        return self.docker_service._map_role(service_name) in {"overmap", "survival"}

    async def _restart_container(self, service: str, *, expected_restart_count: int) -> bool:
        try:
            self.docker_service.validate_container_name(service)
            self._suppressed_restart_counts[service] = expected_restart_count + 1
            container = await asyncio.to_thread(self.docker_service.client.containers.get, service)
            await asyncio.to_thread(container.restart)
            return True
        except (AttributeError, DockerException, NotFound, ValueError) as exc:
            logger.warning("Watchdog could not restart %s: %s", service, exc)
            self._suppressed_restart_counts.pop(service, None)
            return False

    async def _inspect_container(self, service: str) -> ContainerSnapshot | None:
        if not self.docker_service.client:
            return None
        self.docker_service.validate_container_name(service)

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
        oom_killed = bool(state.get("OOMKilled", False))
        return ContainerSnapshot(
            service=container.name,
            status=status,
            exit_code=exit_code,
            restart_count=restart_count,
            oom_killed=oom_killed,
        )

    def _to_crash_dict(self, event: CrashEvent) -> dict[str, Any]:
        return {
            "service": event.service,
            "timestamp": event.timestamp.isoformat(),
            "exitCode": event.exit_code,
            "restarted": event.restarted,
            "message": event.message,
        }
