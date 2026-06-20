from __future__ import annotations

import asyncio
import time
import contextlib
import logging
import os
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from docker.errors import DockerException, NotFound
from sqlalchemy import select

from db.database import SessionLocal
from db.models import WatchdogCrash

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

RESOURCE_CPU_WARN_PCT = float(os.getenv("WATCHDOG_CPU_WARN_PCT", "175"))
"""CPU usage percentage that triggers a warning (>100% = multiple cores).
The default is 175% on the assumption that game-server containers have a
2-core (200%) cap; 175% = 87.5% of allocation. Tune for your CPU limits."""

RESOURCE_WARM_UP_SECONDS = int(os.getenv("WATCHDOG_RESOURCE_WARM_UP_SECONDS", "180"))
"""Skip CPU/memory pressure alerts for this many seconds after a container
starts. Prevents false positives during initialization (world load, NPC
spawn, replication graph build, etc.)."""

RESOURCE_SUSTAINED_SAMPLES = max(1, int(os.getenv("WATCHDOG_RESOURCE_SUSTAINED_SAMPLES", "3")))
"""Number of consecutive over-threshold polls required before alerting.
Prevents single-spike false positives. Default 3 means with the default
30s poll interval, a service must be over-threshold for >=90s to alert."""


def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_docker_time(value: Any) -> datetime | None:
    """Parse a Docker State timestamp (e.g. ``StartedAt``) into a tz-aware
    datetime. Docker emits RFC3339 with nanosecond precision and a trailing
    ``Z`` (e.g. ``2026-06-03T18:22:01.123456789Z``); ``fromisoformat`` can't
    handle >6 fractional digits, so we truncate to microseconds. The sentinel
    ``0001-01-01T00:00:00Z`` (container never started) maps to ``None``."""
    if not value or not isinstance(value, str):
        return None
    s = value.strip()
    if not s or s.startswith("0001-01-01"):
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    if "." in s:
        head, frac = s.split(".", 1)
        tz = ""
        for i, ch in enumerate(frac):
            if ch in "+-":
                tz = frac[i:]
                frac = frac[:i]
                break
        frac = frac[:6]
        s = f"{head}.{frac}{tz}" if frac else f"{head}{tz}"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


# ---------------------------------------------------------------------------
# Exit-code attribution
# ---------------------------------------------------------------------------
# UE5 game-server containers terminate via POSIX signals, so the container
# exit code is 128 + signal number. 139 = SIGSEGV (segfault) and 134 = SIGABRT
# (assert/abort) are upstream Funcom/engine faults we cannot fix from config;
# 137 = SIGKILL almost always means the kernel OOM-killed us (a resource issue
# we CAN act on). 0 and 143 (SIGTERM) are clean stops and are excluded from
# crash detection upstream of here.
_EXIT_CODE_LABELS: dict[int, str] = {
    0: "clean exit",
    1: "generic error",
    132: "SIGILL (illegal instruction)",
    134: "SIGABRT (assert/abort)",
    135: "SIGBUS (bad memory access)",
    136: "SIGFPE (arithmetic error)",
    137: "SIGKILL (forced/OOM)",
    139: "SIGSEGV (segfault)",
    143: "SIGTERM (clean stop)",
}

# Exit codes that indicate an upstream engine fault rather than our config.
_UPSTREAM_EXIT_CODES = {132, 134, 135, 136, 139}

# Log lines that fingerprint a game-server crash, in priority order. Strong
# fatal markers identify the crash directly; weak markers (travel/ensure) are a
# useful upstream fingerprint when no hard-fatal line is present in the tail.
_CRASH_LOG_MARKERS_STRONG = (
    "lowlevelfatalerror",
    "fatal error",
    "assertion failed",
    "=== critical error",
    "caught signal",
    "segmentation fault",
    "signal 11",
    "signal 6",
    "sigsegv",
    "sigabrt",
    "apperror",
)
_CRASH_LOG_MARKERS_WEAK = (
    "logtravelevent",
    "ensure condition failed",
    "getbestserverforlocation",
)


def _exit_code_label(code: int | None) -> str:
    """Short human label for a container exit code (e.g. ``139 SIGSEGV
    (segfault)``). Unknown codes above 128 render as their POSIX signal."""
    if code is None:
        return "unknown"
    if code in _EXIT_CODE_LABELS:
        return f"{code} {_EXIT_CODE_LABELS[code]}"
    if code > 128:
        return f"{code} signal {code - 128}"
    return f"exit {code}"


def _exit_code_attribution(code: int | None) -> str:
    """One-line hint on whether a crash is ours to fix or upstream."""
    if code in _UPSTREAM_EXIT_CODES:
        return "upstream Funcom/UE5 engine fault - not a server-config issue"
    if code == 137:
        return "SIGKILL - usually a kernel OOM-kill; check the container mem_limit"
    if code in (0, 143):
        return "graceful stop - not a crash"
    if code is None:
        return "exit code unavailable (Docker auto-restarted before inspection); see log signature"
    return "non-standard exit - inspect the log signature"


@dataclass(slots=True)
class CrashEvent:
    service: str
    timestamp: datetime
    exit_code: int | None
    restarted: bool
    message: str
    exit_label: str | None = None
    signature: str | None = None
    kind: str = "crash"
    hourly_count: int | None = None


@dataclass(slots=True)
class ContainerSnapshot:
    service: str
    status: str
    exit_code: int | None
    restart_count: int
    oom_killed: bool = False
    started_at: datetime | None = None


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
        # Lifecycle (start/stop/restart) Discord notifications. These cover the
        # gap where a clean operator stop, manual `docker restart`, or recovery
        # from a stopped state produced NO Discord alert (only crashes did).
        # Per-webhook notify_start / notify_stop flags still gate delivery.
        self._notify_lifecycle = _env_flag("WATCHDOG_NOTIFY_LIFECYCLE", True)
        self._lifecycle_cooldown_seconds = int(os.getenv("WATCHDOG_LIFECYCLE_COOLDOWN", "60"))
        # When a crash auto-restart happens we already announce it via the
        # "crash" event ("...Watchdog restarted the container."). Suppress the
        # follow-up lifecycle "start"/"restart" within this window so a single
        # crash recovery doesn't double-post to Discord.
        self._recent_crash_at: dict[str, datetime] = {}
        # Track consecutive over-threshold samples per service,metric so we only
        # alert on sustained pressure (e.g. 3 polls in a row). Resets to 0 each
        # time a poll comes back below threshold.
        self._cpu_streak: dict[str, int] = {}
        self._mem_streak: dict[str, int] = {}
        # Track per-service crash timestamps for hourly rate alerts. Each entry
        # is a deque of UTC epoch seconds; we trim to the last 60 minutes on
        # every poll so memory stays bounded even with sustained crash loops.
        self._crash_timestamps: dict[str, deque[float]] = {}
        self._hourly_crash_threshold = int(os.getenv("WATCHDOG_HOURLY_CRASH_THRESHOLD", "50"))
        """Crashes-per-hour threshold for a Discord alert. Default 50 is high
        on purpose: the upstream Funcom build-1979201 LogTravelEvent segfault
        produces bursts of 10-80 overmap crashes when a player chains travel
        events. Docker auto-restart hides each crash from players, so the
        signal we care about is 'sustained extreme rate suggesting a runaway',
        not 'a few crashes happened'. Lower this only if Funcom resolves the
        upstream bug and you want tighter monitoring."""

        # Ghost AMQP connections can cause "Error: P83" on map travel: when a
        # player's prior session drops uncleanly (network blip, crash, force-quit)
        # the AMQP connection lingers in game-rmq with a consumer still attached to
        # <HEXID>_queue, so the next login's queue.delete fails (precondition_failed)
        # and the client sees P83. Auto-cleanup is DISABLED by default because
        # killing AMQP connections during travel prevented the S2sController peer
        # index from converging (S2S_WaitingForIndex / "GetBestServerForLocation:
        # no server found"). Opt in with WATCHDOG_RMQ_GHOST_CLEANUP=true, or run
        # `dune fix-p83 --apply` manually when needed.
        self._rmq_ghost_cleanup_enabled = _env_flag("WATCHDOG_RMQ_GHOST_CLEANUP", False)
        self._rmq_game_container = os.getenv("WATCHDOG_GAME_RMQ_CONTAINER", "dune-awakening-game-rmq-1")

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

    async def get_crashes(self) -> list[dict[str, Any]]:
        """Return recent crash events, newest first. Reads from the dashboard
        DB so the history survives dashboard-api restarts; falls back to the
        in-memory ring buffer if the DB is unavailable or empty."""
        try:
            async with SessionLocal() as session:
                result = await session.execute(
                    select(WatchdogCrash).order_by(WatchdogCrash.timestamp.desc()).limit(100)
                )
                rows = result.scalars().all()
                if rows:
                    return [self._row_to_crash_dict(row) for row in rows]
        except Exception as exc:  # noqa: BLE001 - never let the DB break the endpoint
            logger.debug("Falling back to in-memory crash history: %s", exc)
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
                await self._emit_lifecycle_events(snapshot, previous)
            if crash_detected:
                if self.auto_restart and snapshot.status != "running":
                    restarted = await self._restart_container(snapshot.service, expected_restart_count=snapshot.restart_count)
                    if restarted:
                        message = f"{message} Watchdog restarted the container."
                    else:
                        message = f"{message} Watchdog restart failed."
                exit_label = _exit_code_label(snapshot.exit_code)
                signature = await self._capture_crash_signature(snapshot.service)
                message = (
                    f"{message} Crash signal: {exit_label} "
                    f"({_exit_code_attribution(snapshot.exit_code)})."
                )
                if signature:
                    message = f"{message} Log signature: {signature}"
                event = CrashEvent(
                    service=snapshot.service,
                    timestamp=datetime.now(timezone.utc),
                    exit_code=snapshot.exit_code,
                    restarted=restarted,
                    message=message,
                    exit_label=exit_label,
                    signature=signature or None,
                    kind="crash",
                )
                self._crash_history.append(event)
                await self._persist_crash(event)
                self._recent_crash_at[snapshot.service] = datetime.now(timezone.utc)
                logger.warning(message)
                await self.discord_service.enqueue("crash", message, title=f"Watchdog crash detected: {snapshot.service}")
            self._known_states[snapshot.service] = snapshot

        # Check resource pressure every poll cycle
        await self._check_resource_pressure()
        # Auto-clean ghost RMQ connections to prevent P83 errors
        await self._check_rmq_ghost_connections()

    async def _check_rmq_ghost_connections(self) -> None:
        """Detect and close stale (not legitimate-in-flight) player connections.

        A player can legitimately have two AMQP connections briefly during map
        travel (source server + destination server). Killing both during the
        handoff is what was *causing* P83, not fixing it. So we only close a
        connection when:

        - The user is a 16-hex-char Steam ID
        - The user has > 1 running connection (duplicate signal)
        - The connection is at least GHOST_MIN_AGE seconds old (debounce; gives
          legitimate travel handoffs time to finish)
        - There is a NEWER connection from the same user (we keep the newest;
          the older one is the ghost)
        """
        if not self._rmq_ghost_cleanup_enabled or not self.docker_service.client:
            return
        try:
            container = await asyncio.to_thread(
                self.docker_service.client.containers.get, self._rmq_game_container
            )
        except Exception:  # noqa: BLE001
            return
        if getattr(container, "status", "") != "running":
            return
        try:
            exec_result = await asyncio.to_thread(
                container.exec_run,
                ["rabbitmqctl", "--quiet", "list_connections", "pid", "user", "state", "connected_at"],
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("Watchdog rmq ghost-cleanup list_connections failed: %s", exc)
            return
        output = (exec_result.output or b"").decode("utf-8", errors="ignore")
        # rabbitmqctl emits "connected_at" as a millisecond unix timestamp.
        per_user: dict[str, list[tuple[int, str]]] = {}
        for raw in output.splitlines():
            parts = raw.split()
            if len(parts) < 4:
                continue
            pid, user, state, connected_at = parts[0], parts[1], parts[2], parts[3]
            if state != "running":
                continue
            if len(user) != 16 or not all(c in "0123456789abcdefABCDEF" for c in user):
                continue
            try:
                ts_ms = int(connected_at)
            except ValueError:
                continue
            per_user.setdefault(user, []).append((ts_ms, pid))
        now_ms = int(time.time() * 1000)
        min_age_ms = max(0, int(os.getenv("WATCHDOG_GHOST_MIN_AGE_SECONDS", "60"))) * 1000
        reason = f"watchdog-ghost-cleanup-{int(time.time())}"
        for user, conns in per_user.items():
            if len(conns) < 2:
                continue
            conns.sort(reverse=True)  # newest first
            # Keep newest; older entries are candidates if they exceed min age.
            for ts_ms, pid in conns[1:]:
                age_ms = now_ms - ts_ms
                if age_ms < min_age_ms:
                    continue
                try:
                    await asyncio.to_thread(
                        container.exec_run,
                        ["rabbitmqctl", "--quiet", "close_connection", pid, reason],
                    )
                    logger.info(
                        "Watchdog closed stale AMQP connection for player %s (pid=%s age=%ds)",
                        user, pid, age_ms // 1000,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Watchdog ghost-cleanup close pid %s failed: %s", pid, exc)

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

        # Track each individual crash timestamp for hourly-rate analysis. We
        # add `delta` entries because `RestartCount` advances once per restart
        # but we may have observed several restarts between polls.
        ts_now = datetime.now(timezone.utc).timestamp()
        if snapshot.service not in self._crash_timestamps:
            self._crash_timestamps[snapshot.service] = deque(maxlen=200)
        bucket = self._crash_timestamps[snapshot.service]
        for _ in range(delta):
            bucket.append(ts_now)
        # Trim entries older than 1 hour so the count reflects current rate.
        cutoff = ts_now - 3600
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        hourly_count = len(bucket)
        if hourly_count >= self._hourly_crash_threshold:
            asyncio.create_task(self._alert_high_crash_rate(snapshot, hourly_count))

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

    async def _emit_lifecycle_events(
        self, snapshot: ContainerSnapshot, previous: ContainerSnapshot
    ) -> None:
        """Announce clean start / stop / restart transitions for a monitored
        game-server container. Crashes are handled separately (the crash path
        never reaches here), so this covers operator stops, manual
        ``docker restart``, and recoveries that previously produced no Discord
        alert at all."""
        if not self._notify_lifecycle:
            return

        was_running = previous.status == "running"
        is_running = snapshot.status == "running"
        now = datetime.now(timezone.utc)

        if was_running and not is_running:
            await self._send_lifecycle_alert("stop", snapshot, now)
        elif not was_running and is_running:
            if not self._suppress_after_crash(snapshot.service, now):
                await self._send_lifecycle_alert("start", snapshot, now)
        elif was_running and is_running:
            # Running on both polls but StartedAt advanced => an in-place
            # `docker restart` (or compose restart) completed between polls.
            if (
                snapshot.started_at is not None
                and previous.started_at is not None
                and (snapshot.started_at - previous.started_at).total_seconds() > 1.0
                and not self._suppress_after_crash(snapshot.service, now)
            ):
                await self._send_lifecycle_alert("restart", snapshot, now)

    def _suppress_after_crash(self, service: str, now: datetime) -> bool:
        """True if a crash alert fired for this service recently enough that the
        follow-up start/restart would be redundant noise."""
        last = self._recent_crash_at.get(service)
        if last is None:
            return False
        return (now - last).total_seconds() < (self.interval_seconds * 2 + 30)

    async def _send_lifecycle_alert(
        self, kind: str, snapshot: ContainerSnapshot, now: datetime
    ) -> None:
        cooldown_key = f"lifecycle-{kind}:{snapshot.service}"
        last_alert = self._alert_cooldowns.get(cooldown_key)
        if last_alert and (now - last_alert).total_seconds() < self._lifecycle_cooldown_seconds:
            return
        self._alert_cooldowns[cooldown_key] = now

        if kind == "stop":
            event_type = "stop"
            code = snapshot.exit_code
            reason = (
                "was stopped by an operator"
                if code in {0, 143}
                else f"stopped unexpectedly (exit code {code})"
            )
            title = f"🔴 Server Stopped: {snapshot.service}"
            message = (
                f"**{snapshot.service}** {reason}. The game world is offline "
                f"until it starts again."
            )
        elif kind == "restart":
            event_type = "start"
            title = f"🔄 Server Restarted: {snapshot.service}"
            message = f"**{snapshot.service}** was restarted and is back online."
        else:  # start
            event_type = "start"
            title = f"🟢 Server Online: {snapshot.service}"
            message = (
                f"**{snapshot.service}** started and is now accepting connections."
            )

        sent = await self.discord_service.enqueue(event_type, message, title=title)
        logger.info(
            "Watchdog lifecycle '%s' for %s queued to %d webhook(s)",
            kind,
            snapshot.service,
            sent,
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
        exit_label = _exit_code_label(snapshot.exit_code)
        signature = await self._capture_crash_signature(snapshot.service)
        msg = (
            f"Crash-loop detected for {snapshot.service}. "
            f"Restart count: {snapshot.restart_count} (+{delta} since last poll, "
            f"+{window_total} over last {len(self._restart_history.get(snapshot.service, []))} polls). "
            f"Last exit: {exit_label}. "
            f"Rapid restart loops waste CPU/memory and can degrade other services "
            f"(e.g. crafting timer glitches from tick-rate drops)."
        )
        if signature:
            msg = f"{msg} Log signature: {signature}"
        logger.warning(msg)
        event = CrashEvent(
            service=snapshot.service,
            timestamp=now,
            exit_code=snapshot.exit_code,
            restarted=False,
            message=msg,
            exit_label=exit_label,
            signature=signature or None,
            kind="crash-loop",
        )
        self._crash_history.append(event)
        await self._persist_crash(event)
        await self.discord_service.enqueue(
            "crash", msg, title=f"Crash-loop: {snapshot.service}"
        )

    async def _alert_high_crash_rate(self, snapshot: ContainerSnapshot, hourly_count: int) -> None:
        """Send a Discord alert when a container has crashed many times in the
        last hour but isn't tripping the per-poll crash-loop threshold (e.g.
        the upstream Funcom LogTravelEvent overmap segfault: Docker
        auto-restart hides each one but the cumulative rate is alert-worthy).
        Cooldown is intentionally long (1 hour) so we don't spam Discord
        during a sustained Funcom-side bug burst."""
        cooldown_key = f"hourly-crash:{snapshot.service}"
        now = datetime.now(timezone.utc)
        last_alert = self._alert_cooldowns.get(cooldown_key)
        if last_alert and (now - last_alert).total_seconds() < 3600:
            return
        self._alert_cooldowns[cooldown_key] = now
        # The container has already been auto-restarted by Docker, so its
        # current exit code is 0/None; the log signature is the reliable
        # forensic datum here, so capture it and use it to attribute the burst.
        signature = await self._capture_crash_signature(snapshot.service)
        attribution = self._attribute_from_signature(signature)
        msg = (
            f"{snapshot.service} has crashed {hourly_count} times in the last hour "
            f"(threshold {self._hourly_crash_threshold}/hr). Docker is auto-restarting "
            f"each crash so most players don't notice individually, but the cumulative "
            f"impact (cross-map travel failures, brief unavailability windows) is real. "
            f"{attribution}"
        )
        if signature:
            msg = f"{msg} Last crash signature: {signature}"
        else:
            msg = (
                f"{msg} No crash signature in recent logs; check the {snapshot.service} "
                f"logs for the fault line and watch Funcom patch notes."
            )
        logger.warning(msg)
        event = CrashEvent(
            service=snapshot.service,
            timestamp=now,
            exit_code=None,
            restarted=True,  # Docker auto-restarted each crash before we polled
            message=msg,
            signature=signature or None,
            kind="high-rate",
            hourly_count=hourly_count,
        )
        self._crash_history.append(event)
        await self._persist_crash(event)
        await self.discord_service.enqueue(
            "crash", msg, title=f"High crash rate: {snapshot.service}"
        )

    async def _check_resource_pressure(self) -> None:
        """Check CPU and memory usage of monitored containers via Docker stats.

        Two false-positive guards are layered on top of a simple threshold:

        * Warm-up: skip alerts for containers that started within
          `RESOURCE_WARM_UP_SECONDS`. Game-server containers spike during
          initialization (world load, NPC spawn, replication graph build).
        * Sustained samples: require `RESOURCE_SUSTAINED_SAMPLES` consecutive
          over-threshold polls before alerting. Prevents single-spike noise.
        """
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
                # Container start time + CPU cap let us produce a richer alert
                # message and suppress alerts during the initialization window.
                started_at: datetime | None = None
                cpu_cap_pct: float | None = None
                try:
                    attrs = container.attrs or {}
                    started = attrs.get("State", {}).get("StartedAt")
                    if started:
                        # Docker emits ISO-8601 with Z suffix.
                        started_at = datetime.fromisoformat(started.replace("Z", "+00:00"))
                    nano_cpus = attrs.get("HostConfig", {}).get("NanoCpus") or 0
                    if nano_cpus > 0:
                        cpu_cap_pct = (nano_cpus / 1_000_000_000.0) * 100.0
                except (TypeError, ValueError, AttributeError):
                    pass
                results.append({
                    "service": container.name,
                    "cpu_pct": cpu_pct,
                    "mem_pct": mem_pct,
                    "mem_used_mb": mem_used_mb,
                    "started_at": started_at,
                    "cpu_cap_pct": cpu_cap_pct,
                })
            return results

        try:
            stats_list = await asyncio.to_thread(_collect_stats)
        except Exception:  # noqa: BLE001
            return

        now = datetime.now(timezone.utc)
        seen_services: set[str] = set()
        for entry in stats_list:
            service = entry["service"]
            seen_services.add(service)

            uptime_seconds: float | None = None
            if entry.get("started_at"):
                uptime_seconds = max(0.0, (now - entry["started_at"]).total_seconds())
            in_warm_up = uptime_seconds is not None and uptime_seconds < RESOURCE_WARM_UP_SECONDS

            # ---- Memory pressure ----
            if entry["mem_pct"] >= RESOURCE_MEM_WARN_PCT:
                self._mem_streak[service] = self._mem_streak.get(service, 0) + 1
            else:
                self._mem_streak[service] = 0

            if (
                self._mem_streak.get(service, 0) >= RESOURCE_SUSTAINED_SAMPLES
                and not in_warm_up
            ):
                cooldown_key = f"mem-pressure:{service}"
                last_alert = self._alert_cooldowns.get(cooldown_key)
                if not last_alert or (now - last_alert).total_seconds() >= self._alert_cooldown_seconds:
                    self._alert_cooldowns[cooldown_key] = now
                    samples = self._mem_streak[service]
                    msg = (
                        f"Memory pressure on {service}: {entry['mem_pct']:.1f}% "
                        f"({entry['mem_used_mb']:.0f} MB used) sustained over "
                        f"{samples} consecutive {self.interval_seconds}s polls. "
                        f"High memory usage can cause tick-rate drops and gameplay glitches. "
                        f"Consider increasing MEM_LIMIT in .env."
                    )
                    logger.warning(msg)
                    await self.discord_service.enqueue("resource", msg, title=f"Memory pressure: {service}")

            # ---- CPU pressure ----
            if entry["cpu_pct"] >= RESOURCE_CPU_WARN_PCT:
                self._cpu_streak[service] = self._cpu_streak.get(service, 0) + 1
            else:
                self._cpu_streak[service] = 0

            if (
                self._cpu_streak.get(service, 0) >= RESOURCE_SUSTAINED_SAMPLES
                and not in_warm_up
            ):
                cooldown_key = f"cpu-pressure:{service}"
                last_alert = self._alert_cooldowns.get(cooldown_key)
                if not last_alert or (now - last_alert).total_seconds() >= self._alert_cooldown_seconds:
                    self._alert_cooldowns[cooldown_key] = now
                    samples = self._cpu_streak[service]
                    cap_pct = entry.get("cpu_cap_pct")
                    if cap_pct and cap_pct > 0:
                        of_cap = entry["cpu_pct"] / cap_pct * 100.0
                        cap_clause = f" ({of_cap:.0f}% of {cap_pct/100:.1f}-core cap)"
                    else:
                        cap_clause = ""
                    uptime_clause = (
                        f" Container has been up {uptime_seconds/60:.0f}m." if uptime_seconds else ""
                    )
                    msg = (
                        f"CPU pressure on {service}: {entry['cpu_pct']:.1f}%{cap_clause} "
                        f"sustained over {samples} consecutive {self.interval_seconds}s polls."
                        f"{uptime_clause} Sustained high CPU can cause tick-rate drops and gameplay glitches."
                    )
                    logger.warning(msg)
                    await self.discord_service.enqueue("resource", msg, title=f"CPU pressure: {service}")

        # Containers we didn't see this poll (stopped/restarting): clear streaks
        # so a single missed sample doesn't carry over into the new lifetime.
        for stale in [s for s in self._cpu_streak if s not in seen_services]:
            del self._cpu_streak[stale]
        for stale in [s for s in self._mem_streak if s not in seen_services]:
            del self._mem_streak[stale]

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
        # Exit codes 0 (clean) and 143 (SIGTERM = `docker stop` / compose stop /
        # compose restart) are not crashes - they're operator-initiated stops.
        # Exit code 137 is SIGKILL (forced) which we DO want to alert on
        # because it usually means the kernel OOM-killed us.
        return (
            snapshot.status in {"exited", "dead"}
            and snapshot.exit_code not in {None, 0, 143}
        )

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
            started_at=_parse_docker_time(state.get("StartedAt")),
        )

    async def _capture_crash_signature(self, service: str) -> str:
        """Best-effort: scan a container's recent logs for the line that best
        fingerprints WHY it crashed (segfault, assert, travel fault, ...). This
        is the key forensic datum when Docker auto-restarts a container before
        we can read its exit code, so it survives in the alert and the DB.
        Returns an empty string if no recognizable signature is present."""
        try:
            lines = await self.docker_service.get_container_logs(service, tail=400)
        except Exception as exc:  # noqa: BLE001 - log capture is best-effort
            logger.debug("Could not read logs for crash signature of %s: %s", service, exc)
            return ""
        strong = ""
        weak = ""
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            lowered = stripped.lower()
            if any(m in lowered for m in _CRASH_LOG_MARKERS_STRONG):
                strong = stripped
            elif any(m in lowered for m in _CRASH_LOG_MARKERS_WEAK):
                weak = stripped
        return (strong or weak)[:500]

    def _attribute_from_signature(self, signature: str) -> str:
        """Infer crash attribution from a log signature line for the high-rate
        alert, where the per-crash exit code isn't available (Docker already
        restarted the container)."""
        sig = (signature or "").lower()
        if not sig:
            return "This is typically an upstream Funcom UE5 bug."
        if any(m in sig for m in ("sigsegv", "segmentation", "signal 11")):
            return (
                "Signature indicates a SIGSEGV (segfault) - an upstream "
                "Funcom/UE5 engine fault, not a server-config issue."
            )
        if any(m in sig for m in ("sigabrt", "assertion", "signal 6", "lowlevelfatalerror")):
            return (
                "Signature indicates an assert/abort (SIGABRT) - an upstream "
                "Funcom/UE5 engine fault, not a server-config issue."
            )
        if "logtravelevent" in sig or "getbestserverforlocation" in sig:
            return (
                "Signature points to the cross-map travel path (LogTravelEvent) - "
                "a known upstream Funcom overmap fault."
            )
        return "This is typically an upstream Funcom UE5 bug; verify against Funcom patch notes."

    async def _persist_crash(self, event: CrashEvent) -> None:
        """Persist a crash event to the dashboard DB so the forensic history
        survives dashboard-api restarts (the in-memory deque does not).
        Failures are swallowed - crash alerting must never depend on the DB
        being writable."""
        try:
            async with SessionLocal() as session:
                session.add(
                    WatchdogCrash(
                        service=event.service,
                        timestamp=event.timestamp,
                        kind=event.kind,
                        exit_code=event.exit_code,
                        exit_label=event.exit_label,
                        restarted=event.restarted,
                        hourly_count=event.hourly_count,
                        signature=event.signature,
                        message=event.message,
                    )
                )
                await session.commit()
        except Exception as exc:  # noqa: BLE001 - persistence is best-effort
            logger.warning("Failed to persist watchdog crash for %s: %s", event.service, exc)

    def _row_to_crash_dict(self, row: WatchdogCrash) -> dict[str, Any]:
        return {
            "service": row.service,
            "timestamp": row.timestamp.isoformat() if row.timestamp else None,
            "kind": row.kind,
            "exitCode": row.exit_code,
            "exitLabel": row.exit_label,
            "restarted": bool(row.restarted),
            "hourlyCount": row.hourly_count,
            "signature": row.signature,
            "message": row.message,
        }

    def _to_crash_dict(self, event: CrashEvent) -> dict[str, Any]:
        return {
            "service": event.service,
            "timestamp": event.timestamp.isoformat(),
            "kind": event.kind,
            "exitCode": event.exit_code,
            "exitLabel": event.exit_label,
            "restarted": event.restarted,
            "hourlyCount": event.hourly_count,
            "signature": event.signature,
            "message": event.message,
        }
