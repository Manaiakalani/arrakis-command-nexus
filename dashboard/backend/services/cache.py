"""Simple TTL cache for frequently-polled dashboard endpoints.

No external dependencies — uses a plain dict with monotonic timestamps.
Each cache entry is a (value, expiry) pair keyed by a string name.
Thread-safe for the single-process async server (no locks needed for
dict reads/writes in CPython under the GIL).
"""

from __future__ import annotations

import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

_store: dict[str, tuple[Any, float]] = {}


def get(key: str) -> Any | None:
    """Return cached value if present and not expired, else ``None``."""
    entry = _store.get(key)
    if entry is None:
        return None
    value, expiry = entry
    if time.monotonic() > expiry:
        _store.pop(key, None)
        return None
    return value


def set(key: str, value: Any, ttl: float) -> None:  # noqa: A001
    """Store *value* under *key* with a TTL in seconds."""
    _store[key] = (value, time.monotonic() + ttl)


def invalidate(*keys: str) -> None:
    """Remove one or more keys from the cache immediately."""
    for key in keys:
        _store.pop(key, None)


def invalidate_prefix(prefix: str) -> None:
    """Remove all keys that start with *prefix*."""
    to_remove = [k for k in _store if k.startswith(prefix)]
    for k in to_remove:
        _store.pop(k, None)


def clear() -> None:
    """Drop every cached entry."""
    _store.clear()
