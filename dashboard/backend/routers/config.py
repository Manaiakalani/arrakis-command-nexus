from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from models.config import ConfigFile, ConfigUpdate
from services.config_service import ConfigService

router = APIRouter(tags=["config"])


@router.get("/config")
async def list_configs(request: Request) -> dict[str, object]:
    service: ConfigService = request.app.state.config_service
    files = await service.list_configs()
    return {"files": files, "definitions": {name: defs for name, defs in ((file, service.get_field_definitions(file)) for file in files)}}


@router.get("/config/{filename}", response_model=ConfigFile)
async def get_config(filename: str, request: Request) -> ConfigFile:
    try:
        return await request.app.state.config_service.read_config(filename)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/config/{filename}", response_model=ConfigFile)
async def update_config(
    filename: str,
    payload: ConfigUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> ConfigFile:
    try:
        return await request.app.state.config_service.update_config(filename, payload, session)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
