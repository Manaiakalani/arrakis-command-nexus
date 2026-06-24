"""API routes for server update management."""

import asyncio
import logging
import os

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel

from services.update_service import get_update_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/updates", tags=["updates"])

# Track in-progress background update
_update_task: asyncio.Task | None = None
_update_result: dict | None = None

# Track in-progress background check
_check_task: asyncio.Task | None = None


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


class AutoUpdateSettingsRequest(BaseModel):
    auto_update_enabled: bool


@router.get("/status", response_model=UpdateStatusResponse)
async def get_update_status():
    """Get current update status."""
    service = get_update_service()
    return service.get_status()


@router.get("/host-info")
async def get_host_info():
    """Return SSH host hints used by the manual-update step list. Driven by env
    vars so the public repo never hardcodes a specific user's hostname."""
    return {
        "ssh_user": os.environ.get("DUNE_SSH_USER", "<your-user>"),
        "ssh_host": os.environ.get("DUNE_SSH_HOST", "<your-host>"),
        "server_dir": os.environ.get("DUNE_SERVER_DIR", "~/dune-server-docker"),
    }


@router.post("/check", response_model=UpdateCheckResponse)
async def check_for_updates():
    """
    Trigger a Steam update check in the background and return immediately.
    The check runs asynchronously (steamcmd takes ~45s); poll GET /updates/status
    for the result — last_check and latest_build update when it completes.
    """
    global _check_task
    service = get_update_service()

    # If a check is already running, return the cached status
    if _check_task is not None and not _check_task.done():
        status = service.get_status()
        return {
            "success": True,
            "current_build": status.get("current_build"),
            "latest_build": status.get("latest_build"),
            "update_available": status.get("update_available", False),
            "current_tag": status.get("current_tag"),
            "last_check": status.get("last_check"),
            "steam_app_id": status.get("steam_app_id"),
            "error": None,
        }

    async def _run_check():
        try:
            await service.check_for_updates()
        except Exception:
            logger.exception("Background update check failed")

    _check_task = asyncio.create_task(_run_check(), name="update-check")

    # Return the current cached state immediately
    status = service.get_status()
    return {
        "success": True,
        "current_build": status.get("current_build"),
        "latest_build": status.get("latest_build"),
        "update_available": status.get("update_available", False),
        "current_tag": status.get("current_tag"),
        "last_check": status.get("last_check"),
        "steam_app_id": status.get("steam_app_id"),
        "error": None,
    }


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
async def trigger_update(background_tasks: BackgroundTasks, request: Request):
    """
    Trigger a server update in the background.
    Downloads new server files via steamcmd, loads Docker images, and restarts containers.
    Returns immediately; poll /updates/status to track progress.
    """
    global _update_task, _update_result

    if _update_task is not None and not _update_task.done():
        raise HTTPException(status_code=409, detail="An update is already in progress")

    service = get_update_service()
    _update_result = None

    async def _run_update():
        global _update_result
        try:
            discord_service = getattr(request.app.state, "discord_service", None)
            if discord_service:
                status = service.get_status()
                await discord_service.enqueue(
                    event_type="update_available",
                    message=(
                        f"⚙️ **Manual Update Triggered**\n\n"
                        f"📦 Current: `{status.get('current_build', 'unknown')}`  →  "
                        f"🆕 Latest: `{status.get('latest_build', 'unknown')}`\n\n"
                        f"Server will restart momentarily."
                    ),
                    title="🔄 Update Starting",
                )
            result = await service.trigger_update()
            _update_result = result
            if discord_service and result.get("success"):
                await discord_service.enqueue(
                    event_type="update_available",
                    message=(
                        f"✅ **Update Complete**\n\n"
                        f"🏷️ New tag: `{result.get('new_tag', 'unknown')}`\n"
                        f"🔁 Restarted: {', '.join(result.get('restarted', []))}"
                    ),
                    title="✅ Update Complete",
                )
            elif discord_service and not result.get("success"):
                await discord_service.enqueue(
                    event_type="update_available",
                    message=f"❌ **Update Failed**\n\n{result.get('error', 'Unknown error')[:300]}",
                    title="❌ Update Failed",
                )
        except Exception as exc:
            logger.exception("Background update task failed")
            _update_result = {"success": False, "error": "Update failed unexpectedly"}

    _update_task = asyncio.create_task(_run_update(), name="server-update")
    return {"status": "started", "message": "Update running in background — monitor logs or Discord for progress"}


@router.get("/trigger/status")
async def get_trigger_status():
    """Get the status of an in-progress or completed background update."""
    global _update_task, _update_result
    if _update_task is None:
        return {"status": "idle"}
    if not _update_task.done():
        return {"status": "running"}
    if _update_result is not None:
        return {"status": "done", "result": _update_result}
    try:
        _update_task.exception()  # consume to avoid "exception was never retrieved"
    except Exception:
        logger.exception("Background update task failed")
    return {"status": "failed", "error": "Update task failed unexpectedly"}


@router.post("/settings")
async def update_settings(payload: AutoUpdateSettingsRequest):
    """Toggle auto-update mode on or off."""
    service = get_update_service()
    service.auto_update_enabled = payload.auto_update_enabled
    import os
    os.environ["UPDATE_AUTO_UPDATE"] = "true" if payload.auto_update_enabled else "false"
    return {"auto_update_enabled": service.auto_update_enabled}
