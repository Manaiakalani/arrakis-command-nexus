"""SSE streaming endpoint for real-time dashboard updates."""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import time

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["events"])

KEEPALIVE_INTERVAL = 15  # seconds


def _verify_token(token: str) -> None:
    """Validate the SSE auth token against DUNE_ADMIN_TOKEN."""
    expected = os.getenv("DUNE_ADMIN_TOKEN", "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Admin token is not configured.")
    if not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail="Invalid token.")


@router.get("/events/stream")
async def event_stream(request: Request, token: str = Query(..., alias="token")):
    """Server-Sent Events endpoint for real-time dashboard updates.

    Auth is via query parameter since EventSource API cannot set headers.
    """
    _verify_token(token)

    event_bus = request.app.state.event_bus

    async def generate():
        sub_id, queue = await event_bus.subscribe()
        try:
            # Send initial connected event
            yield _format_sse("connected", {"clientId": sub_id})
            last_keepalive = time.monotonic()

            while True:
                now = time.monotonic()
                timeout = max(0.5, KEEPALIVE_INTERVAL - (now - last_keepalive))
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=timeout)
                except asyncio.TimeoutError:
                    # Send keepalive comment to prevent connection timeout
                    yield f": keepalive {int(time.time())}\n\n"
                    last_keepalive = time.monotonic()
                    continue

                if msg is None:
                    break

                yield _format_sse(msg["event"], msg["data"])
                last_keepalive = time.monotonic()

                # Check if client disconnected
                if await request.is_disconnected():
                    break
        except asyncio.CancelledError:
            pass
        finally:
            await event_bus.unsubscribe(sub_id)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _format_sse(event_type: str, data: dict) -> str:
    """Format a dict as an SSE message."""
    json_data = json.dumps(data, default=str)
    return f"event: {event_type}\ndata: {json_data}\n\n"
