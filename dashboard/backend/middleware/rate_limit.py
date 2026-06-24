"""Simple in-memory rate limiter middleware for the admin API.

Uses a sliding-window counter per client IP. Configurable via environment
variables:

    DUNE_RATE_LIMIT_RPM   - max requests per minute (default 120)
    DUNE_RATE_LIMIT_BURST  - max burst within a 5s window (default 30)

Health and readiness endpoints are exempt.
"""

from __future__ import annotations

import os
import time
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

_EXEMPT_PATHS = frozenset({"/health", "/api/health", "/ready", "/api/ready"})

_RPM = int(os.getenv("DUNE_RATE_LIMIT_RPM", "120"))
_BURST = int(os.getenv("DUNE_RATE_LIMIT_BURST", "30"))
_WINDOW = 60.0
_BURST_WINDOW = 5.0


class _TokenBucket:
    __slots__ = ("timestamps",)

    def __init__(self) -> None:
        self.timestamps: list[float] = []

    def _prune(self, now: float, window: float) -> None:
        cutoff = now - window
        self.timestamps = [t for t in self.timestamps if t > cutoff]

    def allow(self, now: float) -> bool:
        self._prune(now, _WINDOW)
        if len(self.timestamps) >= _RPM:
            return False
        burst_count = sum(1 for t in self.timestamps if t > now - _BURST_WINDOW)
        if burst_count >= _BURST:
            return False
        self.timestamps.append(now)
        return True


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: object) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self._buckets: dict[str, _TokenBucket] = defaultdict(_TokenBucket)
        self._last_cleanup = time.monotonic()

    async def dispatch(self, request: Request, call_next: object) -> object:
        if request.url.path in _EXEMPT_PATHS:
            return await call_next(request)  # type: ignore[misc]

        client_ip = request.client.host if request.client else "unknown"
        now = time.monotonic()

        # Periodic cleanup of stale buckets (every 5 minutes)
        if now - self._last_cleanup > 300:
            stale_cutoff = now - _WINDOW * 2
            self._buckets = defaultdict(
                _TokenBucket,
                {ip: bucket for ip, bucket in self._buckets.items() if bucket.timestamps and bucket.timestamps[-1] > stale_cutoff},
            )
            self._last_cleanup = now

        if not self._buckets[client_ip].allow(now):
            return JSONResponse(
                {"error": {"code": "RATE_LIMITED", "message": "Rate limit exceeded. Please slow down."}},
                status_code=429,
                headers={"Retry-After": "5"},
            )

        return await call_next(request)  # type: ignore[misc]
