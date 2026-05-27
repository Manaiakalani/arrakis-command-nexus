from __future__ import annotations

import asyncio
import contextlib
import logging
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
        if event_type is None:
            return webhooks
        flag = self._event_flags.get(event_type)
        if not flag:
            return webhooks
        return [webhook for webhook in webhooks if getattr(webhook, flag, False)]

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
            except httpx.HTTPError as exc:
                logger.warning("Discord webhook delivery failed: %s", exc)
            finally:
                self.queue.task_done()
