"""Lightweight in-process TTL cache for the dashboard backend."""

from __future__ import annotations

import asyncio
import time
from typing import Any, Callable, Coroutine


class TTLCache:
    """Simple async-aware cache with per-key TTL expiration."""

    def __init__(self, default_ttl: float = 10.0) -> None:
        self._default_ttl = default_ttl
        self._store: dict[str, tuple[float, Any]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock_for(self, key: str) -> asyncio.Lock:
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        return self._locks[key]

    async def get_or_fetch(
        self,
        key: str,
        fetcher: Callable[[], Coroutine[Any, Any, Any]],
        ttl: float | None = None,
    ) -> Any:
        """Return cached value if fresh, otherwise call *fetcher* and cache the result."""
        now = time.monotonic()
        entry = self._store.get(key)
        if entry is not None:
            expires_at, value = entry
            if now < expires_at:
                return value

        async with self._lock_for(key):
            # Double-check after acquiring lock
            entry = self._store.get(key)
            if entry is not None:
                expires_at, value = entry
                if now < expires_at:
                    return value

            value = await fetcher()
            self._store[key] = (now + (ttl if ttl is not None else self._default_ttl), value)
            return value

    def invalidate(self, key: str) -> None:
        self._store.pop(key, None)

    def clear(self) -> None:
        self._store.clear()


# Overview cache invalidation callback — set by dashboard.py at import time
_invalidate_overview_cb = None

def register_overview_invalidation(cb):
    global _invalidate_overview_cb
    _invalidate_overview_cb = cb

def invalidate_overview() -> None:
    if _invalidate_overview_cb:
        _invalidate_overview_cb()
