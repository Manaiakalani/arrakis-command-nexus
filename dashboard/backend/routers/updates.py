"""API routes for server update management."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.update_service import get_update_service

router = APIRouter(prefix="/updates", tags=["updates"])


class UpdateCheckResponse(BaseModel):
    """Response model for update check."""
    success: bool
    current_build: str | None = None
    latest_build: str | None = None
    update_available: bool = False
    current_tag: str | None = None
    last_check: str | None = None
    steam_app_id: str | None = None
    error: str | None = None


class UpdateStatusResponse(BaseModel):
    """Response model for update status."""
    current_tag: str
    current_build: str | None
    latest_build: str | None
    update_available: bool
    last_check: str | None
    auto_update_enabled: bool
    check_interval_hours: int
    steam_app_id: str


@router.get("/status", response_model=UpdateStatusResponse)
async def get_update_status():
    """Get current update status."""
    service = get_update_service()
    return service.get_status()


@router.post("/check", response_model=UpdateCheckResponse)
async def check_for_updates():
    """Check Steam for available updates."""
    service = get_update_service()
    result = await service.check_for_updates()
    
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Update check failed"))
    
    return result


@router.post("/mark-current")
async def mark_as_current():
    """
    Mark the current Steam build as installed baseline, clearing the update banner.
    Call this after running './dune update' to dismiss the notification.
    """
    service = get_update_service()
    result = await service.mark_as_current()

    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Failed to mark as current"))

    return result


@router.post("/trigger")
async def trigger_update():
    """
    Trigger a server update.
    Note: Currently requires manual intervention.
    """
    service = get_update_service()
    result = await service.trigger_update()
    
    if not result.get("success"):
        raise HTTPException(
            status_code=501,
            detail=result.get("error", "Update trigger failed")
        )
    
    return result
