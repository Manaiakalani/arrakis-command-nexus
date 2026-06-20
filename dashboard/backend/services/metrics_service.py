from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any

import psutil
from sqlalchemy import delete, select

from db.database import SessionLocal
from db.models import MetricSnapshot
from models.system import SystemMetricSnapshot

logger = logging.getLogger(__name__)

BYTES_PER_MIB = 1024 * 1024
BYTES_PER_GIB = 1024**3


class MetricsService:
    def __init__(self, interval_seconds: int = 15, retention: int = 172800) -> None:
        self.interval_seconds = max(interval_seconds, 5)
        self.root_path = os.getenv("DUNE_METRICS_DISK_PATH", "/")
        self.snapshots: deque[SystemMetricSnapshot] = deque(maxlen=max(retention, 1))
        self._task: asyncio.Task[None] | None = None
        self._previous_net: tuple[int, int] | None = None
        self._previous_disk: tuple[int, int] | None = None
        self._previous_time: datetime | None = None
        self._collected_snapshots = 0

    async def start(self) -> None:
        # Blocking seed: measure real CPU over 1 second so the first snapshot is accurate
        await asyncio.to_thread(psutil.cpu_percent, 1)
        await self.collect_snapshot()
        await self._backfill_snapshots_from_db()
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
        await self._persist_snapshot(snapshot)
        self._collected_snapshots += 1
        if self._collected_snapshots % 100 == 0:
            await self._prune_old_snapshots()
        return snapshot

    async def get_current_metrics(self) -> dict[str, Any]:
        if not self.snapshots:
            await self.collect_snapshot()
        else:
            age = (datetime.now(timezone.utc) - self.snapshots[-1].timestamp).total_seconds()
            if age > self.interval_seconds * 2:
                await self.collect_snapshot()
        return self.snapshots[-1].model_dump(mode="json")

    async def get_snapshots(self, duration: timedelta = timedelta(hours=24)) -> list[SystemMetricSnapshot]:
        cutoff = datetime.now(timezone.utc) - max(duration, timedelta(minutes=1))
        return [snapshot for snapshot in self.snapshots if snapshot.timestamp >= cutoff]

    async def get_history(self, duration: timedelta = timedelta(hours=24)) -> list[dict[str, Any]]:
        snapshots = await self.get_snapshots(duration=duration)
        return [snapshot.model_dump(mode="json") for snapshot in snapshots]

    async def _backfill_snapshots_from_db(self) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        try:
            async with SessionLocal() as session:
                result = await session.execute(
                    select(MetricSnapshot)
                    .where(MetricSnapshot.timestamp >= cutoff)
                    .order_by(MetricSnapshot.timestamp)
                )
                rows = result.scalars().all()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Metrics history backfill failed: %s", exc)
            return

        self.snapshots.clear()
        for row in rows:
            self.snapshots.append(self._snapshot_from_record(row))

    async def _persist_snapshot(self, snapshot: SystemMetricSnapshot) -> None:
        try:
            async with SessionLocal() as session:
                session.add(self._record_from_snapshot(snapshot))
                await session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Metrics snapshot persistence failed: %s", exc)

    async def _prune_old_snapshots(self) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=35)
        try:
            async with SessionLocal() as session:
                await session.execute(delete(MetricSnapshot).where(MetricSnapshot.timestamp < cutoff))
                await session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Metrics snapshot pruning failed: %s", exc)

    def _record_from_snapshot(self, snapshot: SystemMetricSnapshot) -> MetricSnapshot:
        return MetricSnapshot(
            timestamp=self._as_utc(snapshot.timestamp),
            cpu_percent=snapshot.cpu_percent,
            memory_percent=snapshot.memory_percent,
            disk_percent=snapshot.disk_percent,
            mem_used_bytes=snapshot.memory_used_mb * BYTES_PER_MIB,
            mem_total_bytes=snapshot.memory_total_mb * BYTES_PER_MIB,
            disk_used_bytes=snapshot.disk_used_gb * BYTES_PER_GIB,
            disk_total_bytes=snapshot.disk_total_gb * BYTES_PER_GIB,
            net_sent_bps=snapshot.network_sent_bps,
            net_recv_bps=snapshot.network_recv_bps,
            disk_read_bps=snapshot.disk_read_bps,
            disk_write_bps=snapshot.disk_write_bps,
            load_avg_1=float(snapshot.load.get("1m", 0.0) or 0.0),
            load_avg_5=float(snapshot.load.get("5m", 0.0) or 0.0),
            load_avg_15=float(snapshot.load.get("15m", 0.0) or 0.0),
        )

    def _snapshot_from_record(self, record: MetricSnapshot) -> SystemMetricSnapshot:
        load = {
            "1m": record.load_avg_1,
            "5m": record.load_avg_5,
            "15m": record.load_avg_15,
        }
        return SystemMetricSnapshot(
            timestamp=self._as_utc(record.timestamp),
            cpu_percent=record.cpu_percent,
            memory_percent=record.memory_percent,
            memory_used_mb=round(record.mem_used_bytes / BYTES_PER_MIB, 2),
            memory_total_mb=round(record.mem_total_bytes / BYTES_PER_MIB, 2),
            disk_percent=record.disk_percent,
            disk_used_gb=round(record.disk_used_bytes / BYTES_PER_GIB, 2),
            disk_total_gb=round(record.disk_total_bytes / BYTES_PER_GIB, 2),
            network_sent_bps=record.net_sent_bps,
            network_recv_bps=record.net_recv_bps,
            disk_read_bps=record.disk_read_bps,
            disk_write_bps=record.disk_write_bps,
            load=load,
        )

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

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
