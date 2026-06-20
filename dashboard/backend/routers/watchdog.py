from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(tags=["watchdog"])


@router.get("/watchdog/status")
async def get_watchdog_status(request: Request) -> dict:
    return request.app.state.watchdog_service.get_status()


@router.get("/watchdog/crashes")
async def get_watchdog_crashes(request: Request) -> list[dict]:
    return await request.app.state.watchdog_service.get_crashes()


@router.post("/watchdog/restart/{service}")
async def restart_watchdog_service(service: str, request: Request) -> dict:
    try:
        return await request.app.state.watchdog_service.restart_service(service)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
