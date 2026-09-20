"""Central event bus for SSE push notifications.

Each SSE client gets an asyncio.Queue. A background poller detects
data changes and fans events out to all connected clients.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import os
import time
from typing import Any

from services.health_status import readiness_to_health, service_to_frontend

logger = logging.getLogger(__name__)


class EventBus:
    """Fan-out event bus backed by per-subscriber asyncio.Queues."""

    def __init__(self) -> None:
        self._subscribers: dict[int, asyncio.Queue[dict | None]] = {}
        self._counter = 0
        self._lock = asyncio.Lock()

    async def subscribe(self) -> tuple[int, asyncio.Queue[dict | None]]:
        async with self._lock:
            self._counter += 1
            sub_id = self._counter
            q: asyncio.Queue[dict | None] = asyncio.Queue(maxsize=64)
            self._subscribers[sub_id] = q
            logger.info("SSE client %d connected (%d total)", sub_id, len(self._subscribers))
            return sub_id, q

    async def unsubscribe(self, sub_id: int) -> None:
        async with self._lock:
            self._subscribers.pop(sub_id, None)
            logger.info("SSE client %d disconnected (%d remaining)", sub_id, len(self._subscribers))

    async def publish(self, event_type: str, data: Any) -> None:
        """Push an event to every connected client. Drop if queue is full."""
        payload = {"event": event_type, "data": data, "ts": time.time()}
        async with self._lock:
            for sub_id, q in list(self._subscribers.items()):
                try:
                    q.put_nowait(payload)
                except asyncio.QueueFull:
                    logger.warning(
                        "SSE client %d queue full - dropping event %s",
                        sub_id,
                        event_type,
                    )

    @property
    def client_count(self) -> int:
        return len(self._subscribers)


def _snapshot_hash(obj: Any) -> str:
    """Deterministic hash of a JSON-serialisable object."""
    raw = json.dumps(obj, sort_keys=True, default=str)
    return hashlib.md5(raw.encode()).hexdigest()


class ChangeDetector:
    """Polls dashboard data sources and publishes events only when data changes."""

    def __init__(self, bus: EventBus, app_state: Any, interval: float = 10.0) -> None:
        self._bus = bus
        self._app = app_state
        self._interval = interval
        self._task: asyncio.Task[None] | None = None
        self._prev_hashes: dict[str, str] = {}

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="sse-change-detector")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    async def _run(self) -> None:
        while True:
            try:
                await asyncio.sleep(self._interval)
                if self._bus.client_count == 0:
                    continue
                await self._poll_and_push()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("SSE change-detector poll failed", exc_info=True)

    async def _poll_and_push(self) -> None:
        docker = self._app.docker_service
        postgres = self._app.postgres_service
        metrics_svc = self._app.metrics_service

        await self._poll_status(docker, postgres)
        await self._poll_maps(docker)
        await self._poll_metrics(metrics_svc)
        await self._poll_players(postgres)

    async def _poll_status(self, docker: Any, postgres: Any) -> None:
        try:
            services = await docker.list_containers()
            players = await postgres.get_online_players()
            readiness = docker.evaluate_readiness(services)
            uptime = docker.calculate_uptime(services)

            from services.env_file import funcom_image_tag, live_world_name

            maps_active = docker.count_running_maps(services)

            status_data = {
                "serverName": live_world_name(),
                "region": os.getenv("WORLD_REGION", "North America"),
                "status": readiness_to_health(readiness["status"]),
                "uptimeSeconds": uptime or 0,
                "playersOnline": len(players),
                "mapsActive": maps_active,
                "maxPlayers": int(os.getenv("DUNE_MAX_PLAYERS", "70")),
                "version": funcom_image_tag(),
                "services": [service_to_frontend(s) for s in services],
            }
            await self._push_if_changed("status-update", status_data)
        except Exception:
            logger.debug("SSE status poll failed", exc_info=True)

    async def _poll_maps(self, docker: Any) -> None:
        try:
            raw_maps = await docker.list_map_statuses()
            maps_data = [
                {
                    "name": m.name,
                    "status": m.status,
                    "players": m.player_count,
                    "maxPlayers": 70,
                    "memoryUsedMb": round(m.memory_usage_mb or 0, 1),
                    "memoryLimitMb": round(m.memory_limit_mb or 0, 1),
                    "cpuPercent": round(m.cpu_percent, 1)
                    if m.cpu_percent is not None
                    else 0,
                    "uptimeSeconds": round(m.uptime_seconds)
                    if m.uptime_seconds is not None
                    else None,
                }
                for m in raw_maps
            ]
            await self._push_if_changed("map-update", maps_data)
        except Exception:
            logger.debug("SSE maps poll failed", exc_info=True)

    async def _poll_metrics(self, metrics_svc: Any) -> None:
        try:
            snaps = metrics_svc.snapshots
            if snaps:
                latest = snaps[-1]
                metrics_data = {
                    "cpuPercent": latest.cpu_percent,
                    "memoryPercent": latest.memory_percent,
                    "memoryUsedGb": latest.memory_used_bytes / (1024**3)
                    if latest.memory_used_bytes
                    else 0,
                    "memoryTotalGb": latest.memory_total_bytes / (1024**3)
                    if latest.memory_total_bytes
                    else 0,
                    "diskPercent": latest.disk_percent,
                    "diskUsedGb": latest.disk_used_bytes / (1024**3)
                    if latest.disk_used_bytes
                    else 0,
                    "diskTotalGb": latest.disk_total_bytes / (1024**3)
                    if latest.disk_total_bytes
                    else 0,
                    "networkInMbps": (latest.network_in_bytes_sec or 0) / 125000,
                    "networkOutMbps": (latest.network_out_bytes_sec or 0) / 125000,
                }
                await self._push_if_changed("metrics-update", metrics_data)
        except Exception:
            logger.debug("SSE metrics poll failed", exc_info=True)

    async def _poll_players(self, postgres: Any) -> None:
        try:
            player_count = len(await postgres.get_online_players())
            await self._push_if_changed(
                "player-update", {"playersOnline": player_count}
            )
        except Exception:
            logger.debug("SSE player poll failed", exc_info=True)

    async def _push_if_changed(self, event_type: str, data: Any) -> None:
        h = _snapshot_hash(data)
        if self._prev_hashes.get(event_type) == h:
            return
        self._prev_hashes[event_type] = h
        await self._bus.publish(event_type, data)
