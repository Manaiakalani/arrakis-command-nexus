"""Consolidated overview endpoint for the dashboard landing page."""

from __future__ import annotations
from services.cache import invalidate_overview, register_overview_invalidation

import asyncio
import logging

from fastapi import APIRouter, Request

from routers.status import get_status, get_ready
from routers.maps import list_maps
from routers.system import get_system_metrics, get_system_history, get_uptime
from routers.backups import list_backups
from services.cache import TTLCache

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dashboard"])

_cache = TTLCache(default_ttl=5.0)
register_overview_invalidation(lambda: _cache.invalidate('dashboard:overview'))


# invalidate_overview moved to services/cache.py
@router.get("/dashboard/overview")
async def get_overview(request: Request) -> dict:
    """Return all data the overview page needs in a single response."""

    async def _fetch_status():
        return await get_status(request)

    async def _fetch_ready():
        return await get_ready(request)

    async def _fetch_maps():
        return await list_maps(request)

    async def _fetch_metrics():
        return await get_system_metrics(request)

    async def _fetch_history():
        return await get_system_history(request, range="1h")

    async def _fetch_uptime():
        return await get_uptime(request, range="24h")

    async def _fetch_backups():
        return await list_backups(request)

    async def _fetch_all():
        results = await asyncio.gather(
            _fetch_status(),
            _fetch_ready(),
            _fetch_maps(),
            _fetch_metrics(),
            _fetch_history(),
            _fetch_uptime(),
            _fetch_backups(),
            return_exceptions=True,
        )

        def _safe(val, fallback):
            return fallback if isinstance(val, BaseException) else val

        return {
            "status": _safe(results[0], {}),
            "readiness": _safe(results[1], {}),
            "maps": _safe(results[2], []),
            "metrics": _safe(results[3], {}),
            "systemHistory": _safe(results[4], {"range": "1h", "points": []}),
            "uptime": _safe(results[5], {"range": "24h", "availabilityPercent": 0, "totalUpSeconds": 0, "totalDownSeconds": 0, "events": []}),
            "backups": _safe(results[6], []),
        }

    return await _cache.get_or_fetch("dashboard:overview", _fetch_all)
