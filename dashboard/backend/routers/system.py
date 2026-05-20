from __future__ import annotations

from fastapi import APIRouter, Query, Request

router = APIRouter(tags=["system"])


@router.get("/system")
async def get_system_metrics(request: Request) -> dict[str, object]:
    return await request.app.state.metrics_service.get_current_metrics()


@router.get("/system/history")
async def get_system_history(
    request: Request,
    hours: int = Query(default=24, ge=1, le=168),
) -> dict[str, object]:
    history = await request.app.state.metrics_service.get_history(hours=hours)
    return {"hours": hours, "snapshots": history}
