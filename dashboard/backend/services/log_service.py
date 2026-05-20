from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
from datetime import datetime, timezone
from typing import AsyncGenerator

from docker.errors import DockerException

from middleware.redaction import redact
from models.log import LogEntry
from services.docker_service import DockerService

logger = logging.getLogger(__name__)


class LogService:
    def __init__(self, docker_service: DockerService) -> None:
        self.docker_service = docker_service

    async def recent_logs(self, service: str, tail: int = 200) -> list[dict[str, str]]:
        lines = await self.docker_service.get_container_logs(service, tail=tail, follow=False)
        return [self._make_entry(service, line).model_dump(mode="json") for line in lines]

    async def stream_logs(
        self,
        service: str | None = None,
        tail: int = 100,
    ) -> AsyncGenerator[dict[str, str], None]:
        services = [service] if service else [item.name for item in await self.docker_service.list_containers() if item.status == "running"]
        if not services:
            yield {"event": "log", "data": '{"service":"dashboard","severity":"INFO","message":"No running containers available.","timestamp":""}'}
            return

        queue: asyncio.Queue[dict[str, str]] = asyncio.Queue()
        stop_event = threading.Event()
        loop = asyncio.get_running_loop()
        threads = [
            threading.Thread(
                target=self._stream_container_logs,
                args=(name, tail, queue, loop, stop_event),
                daemon=True,
            )
            for name in services
        ]
        for thread in threads:
            thread.start()

        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=15)
                    yield {"event": "log", "data": item["data"]}
                except asyncio.TimeoutError:
                    yield {
                        "event": "heartbeat",
                        "data": datetime.now(timezone.utc).isoformat(),
                    }
        finally:
            stop_event.set()
            for thread in threads:
                await asyncio.to_thread(thread.join, 1.0)

    def _stream_container_logs(
        self,
        service: str,
        tail: int,
        queue: asyncio.Queue[dict[str, str]],
        loop: asyncio.AbstractEventLoop,
        stop_event: threading.Event,
    ) -> None:
        try:
            iterator = self.docker_service.open_log_stream(service, tail=tail)
            for raw_line in iterator:
                if stop_event.is_set():
                    break
                line = redact(raw_line.decode("utf-8", errors="replace")).strip()
                if not line:
                    continue
                payload = self._make_entry(service, line).model_dump_json()
                loop.call_soon_threadsafe(queue.put_nowait, {"data": payload})
        except (DockerException, RuntimeError) as exc:
            logger.warning("Unable to stream logs for %s: %s", service, exc)
            payload = self._make_entry(service, f"Log streaming unavailable: {exc}").model_dump_json()
            with contextlib.suppress(RuntimeError):
                loop.call_soon_threadsafe(queue.put_nowait, {"data": payload})

    def _make_entry(self, service: str, line: str) -> LogEntry:
        severity = "INFO"
        lowered = line.lower()
        if any(token in lowered for token in ("error", "exception", "fatal", "traceback")):
            severity = "ERROR"
        elif any(token in lowered for token in ("warn", "warning")):
            severity = "WARN"
        return LogEntry(
            timestamp=datetime.now(timezone.utc),
            service=service,
            severity=severity,
            message=line,
        )
