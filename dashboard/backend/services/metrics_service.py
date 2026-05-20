from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any

import psutil

from models.system import SystemMetricSnapshot

logger = logging.getLogger(__name__)


class MetricsService:
    def __init__(self, interval_seconds: int = 60, retention: int = 1440) -> None:
        self.interval_seconds = max(interval_seconds, 5)
        self.root_path = os.getenv("DUNE_METRICS_DISK_PATH", "/")
        self.snapshots: deque[SystemMetricSnapshot] = deque(maxlen=retention)
        self._task: asyncio.Task[None] | None = None
        self._previous_net: tuple[int, int] | None = None
        self._previous_disk: tuple[int, int] | None = None
        self._previous_time: datetime | None = None

    async def start(self) -> None:
        await self.collect_snapshot()
        self._task = asyncio.create_task(self._run(), name="metrics-service")

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
                await asyncio.sleep(self.interval_seconds)
                await self.collect_snapshot()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Metrics collection failed: %s", exc)

    async def collect_snapshot(self) -> SystemMetricSnapshot:
        snapshot = await asyncio.to_thread(self._collect_snapshot_sync)
        self.snapshots.append(snapshot)
        return snapshot

    async def get_current_metrics(self) -> dict[str, Any]:
        if not self.snapshots:
            await self.collect_snapshot()
        return self.snapshots[-1].model_dump(mode="json")

    async def get_history(self, hours: int = 24) -> list[dict[str, Any]]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(hours, 1))
        return [snapshot.model_dump(mode="json") for snapshot in self.snapshots if snapshot.timestamp >= cutoff]

    def _collect_snapshot_sync(self) -> SystemMetricSnapshot:
        timestamp = datetime.now(timezone.utc)
        vm = psutil.virtual_memory()
        disk = psutil.disk_usage(self.root_path)
        net = psutil.net_io_counters()
        disk_io = psutil.disk_io_counters()
        seconds = 0.0
        if self._previous_time is not None:
            seconds = max((timestamp - self._previous_time).total_seconds(), 1.0)

        sent_bps = recv_bps = read_bps = write_bps = 0.0
        if self._previous_net and seconds:
            sent_bps = (net.bytes_sent - self._previous_net[0]) / seconds
            recv_bps = (net.bytes_recv - self._previous_net[1]) / seconds
        if self._previous_disk and disk_io and seconds:
            read_bps = (disk_io.read_bytes - self._previous_disk[0]) / seconds
            write_bps = (disk_io.write_bytes - self._previous_disk[1]) / seconds

        self._previous_net = (net.bytes_sent, net.bytes_recv)
        if disk_io:
            self._previous_disk = (disk_io.read_bytes, disk_io.write_bytes)
        self._previous_time = timestamp

        load: dict[str, Any] = {}
        if hasattr(psutil, "getloadavg"):
            with contextlib.suppress(OSError):
                one, five, fifteen = psutil.getloadavg()
                load = {"1m": one, "5m": five, "15m": fifteen}

        return SystemMetricSnapshot(
            timestamp=timestamp,
            cpu_percent=psutil.cpu_percent(interval=None),
            memory_percent=vm.percent,
            memory_used_mb=round(vm.used / (1024 * 1024), 2),
            memory_total_mb=round(vm.total / (1024 * 1024), 2),
            disk_percent=disk.percent,
            disk_used_gb=round(disk.used / (1024**3), 2),
            disk_total_gb=round(disk.total / (1024**3), 2),
            network_sent_bps=round(sent_bps, 2),
            network_recv_bps=round(recv_bps, 2),
            disk_read_bps=round(read_bps, 2),
            disk_write_bps=round(write_bps, 2),
            load=load,
        )
