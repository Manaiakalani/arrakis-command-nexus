from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from db.database import SessionLocal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import DiscordWebhook
from models.discord import DiscordWebhookCreate, DiscordWebhookUpdate

logger = logging.getLogger(__name__)


class DiscordService:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.client = httpx.AsyncClient(timeout=10.0)
        self._worker: asyncio.Task[None] | None = None
        # In-memory delivery stats keyed by webhook id. Survives until the
        # container restarts; surfaces real send activity in the dashboard
        # without requiring a DB schema migration.
        self._stats: dict[int, dict[str, Any]] = {}
        self._colors = {
            "start": 0x2ECC71,
            "stop": 0xE74C3C,
            "crash": 0xE67E22,
            "player": 0x3498DB,
            "test": 0x9B59B6,
        }
        self._event_flags = {
            "start": "notify_start",
            "stop": "notify_stop",
            "crash": "notify_crash",
            "player_join": "notify_player_join",
            "player_leave": "notify_player_leave",
            "update_available": "notify_update_available",
            # Per-category system events (each has its own toggle).
            "resource": "notify_resource",
            "scheduled_restart": "notify_scheduled_restart",
            "backup_completed": "notify_backup",
            "backup_failed": "notify_backup",
            "admin_action": "notify_admin_action",
        }

    async def start(self) -> None:
        self._worker = asyncio.create_task(self._dispatch_loop(), name="discord-dispatcher")

    async def stop(self) -> None:
        if self._worker is not None:
            self._worker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._worker
            self._worker = None
        await self.client.aclose()

    async def list_webhooks(self, session: AsyncSession) -> list[DiscordWebhook]:
        result = await session.execute(select(DiscordWebhook).order_by(DiscordWebhook.created_at.desc()))
        return list(result.scalars().all())

    async def create_webhook(self, session: AsyncSession, payload: DiscordWebhookCreate) -> DiscordWebhook:
        webhook = DiscordWebhook(url=str(payload.url), **payload.model_dump(exclude={"url"}))
        session.add(webhook)
        await session.commit()
        await session.refresh(webhook)
        return webhook

    async def update_webhook(self, session: AsyncSession, webhook_id: int, payload: DiscordWebhookUpdate) -> DiscordWebhook:
        webhook = await session.get(DiscordWebhook, webhook_id)
        if webhook is None:
            raise LookupError("Webhook not found")
        for key, value in payload.model_dump(exclude_none=True).items():
            setattr(webhook, key, value)
        await session.commit()
        await session.refresh(webhook)
        return webhook

    async def delete_webhook(self, session: AsyncSession, webhook_id: int) -> None:
        webhook = await session.get(DiscordWebhook, webhook_id)
        if webhook is None:
            raise LookupError("Webhook not found")
        await session.delete(webhook)
        await session.commit()

    async def send_test(self, session: AsyncSession, webhook_id: int | None, message: str) -> int:
        webhooks = await self._select_targets(session, webhook_id=webhook_id)
        for webhook in webhooks:
            await self.queue.put(
                {
                    "webhook_id": webhook.id,
                    "event": "test",
                    "message": message,
                    "url": webhook.url,
                    "payload": self._build_payload("test", "Dune Dashboard Test", message),
                }
            )
        return len(webhooks)

    async def announce(self, session: AsyncSession, title: str, message: str, event_type: str) -> int:
        webhooks = await self._select_targets(session, event_type=event_type)
        for webhook in webhooks:
            await self.queue.put(
                {
                    "webhook_id": webhook.id,
                    "event": event_type,
                    "message": message,
                    "url": webhook.url,
                    "payload": self._build_payload(event_type, title, message),
                }
            )
        return len(webhooks)

    async def queue_event(self, session: AsyncSession, event_type: str, title: str, message: str) -> int:
        return await self.announce(session, title, message, event_type)

    async def enqueue(self, event_type: str, message: str, title: str | None = None) -> int:
        async with SessionLocal() as session:
            webhooks = await self._select_targets(session, event_type=event_type)
            rendered_title = title or f"Dune Dashboard {event_type.title()}"
            for webhook in webhooks:
                await self.queue.put(
                    {
                        "webhook_id": webhook.id,
                        "event": event_type,
                        "message": message,
                        "url": webhook.url,
                        "payload": self._build_payload(event_type, rendered_title, message),
                    }
                )
            return len(webhooks)

    async def _select_targets(
        self,
        session: AsyncSession,
        webhook_id: int | None = None,
        event_type: str | None = None,
    ) -> list[DiscordWebhook]:
        if webhook_id is not None:
            webhook = await session.get(DiscordWebhook, webhook_id)
            if webhook is None:
                raise LookupError("Webhook not found")
            return [webhook]

        webhooks = await self.list_webhooks(session)
        # Filter out disabled webhooks
        webhooks = [w for w in webhooks if getattr(w, "enabled", True)]
        if event_type is None:
            return webhooks
        flag = self._event_flags.get(event_type)
        if not flag:
            return webhooks
        return [webhook for webhook in webhooks if getattr(webhook, "enabled", True) and getattr(webhook, flag, False)]

    def _build_payload(self, event_type: str, title: str, message: str) -> dict[str, Any]:
        return {
            "embeds": [
                {
                    "title": title,
                    "description": message,
                    "color": self._colors.get(event_type, self._colors["player"]),
                }
            ]
        }

    async def _dispatch_loop(self) -> None:
        while True:
            job = await self.queue.get()
            try:
                response = await self.client.post(job["url"], json=job["payload"])
                response.raise_for_status()
                self._record(job, "sent", healthy=True)
            except httpx.HTTPError as exc:
                logger.warning("Discord webhook delivery failed: %s", exc)
                self._record(job, "failed", healthy=False, detail=str(exc))
            finally:
                self.queue.task_done()

    def _record(
        self,
        job: dict[str, Any],
        status: str,
        *,
        healthy: bool,
        detail: str | None = None,
    ) -> None:
        """Record a delivery attempt in the in-memory stats store."""
        webhook_id = job.get("webhook_id")
        if webhook_id is None:
            return
        now = datetime.now(timezone.utc)
        stats = self._stats.setdefault(
            webhook_id, {"last_triggered_at": None, "healthy": True, "recent": []}
        )
        stats["healthy"] = healthy
        if status == "sent":
            stats["last_triggered_at"] = now.isoformat()
        event = job.get("event", "event")
        message = detail or job.get("message", "")
        record = {
            "id": str(uuid.uuid4()),
            "event": event,
            "status": status,
            "createdAt": now.isoformat(),
            "message": message,
        }
        stats["recent"].insert(0, record)
        del stats["recent"][10:]

    def get_stats(self, webhook_id: int) -> dict[str, Any]:
        """Return delivery stats for a webhook in frontend-ready shape."""
        stats = self._stats.get(webhook_id)
        if not stats:
            return {"lastTriggeredAt": None, "isHealthy": True, "recentEvents": []}
        return {
            "lastTriggeredAt": stats["last_triggered_at"],
            "isHealthy": stats["healthy"],
            "recentEvents": list(stats["recent"]),
        }
