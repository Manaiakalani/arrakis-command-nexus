from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from models.config import ConfigUpdate
from services.config_service import ConfigService

router = APIRouter(tags=["config"])


def _config_to_frontend(config) -> dict:
    """Convert backend ConfigFile (sections dict) to frontend expected shape."""
    fields = []
    sections = getattr(config, "sections", {}) or {}
    for section_name, keys in sections.items():
        for key, value in keys.items():
            field_type = "string"
            parsed_value: str | int | float | bool = value
            low = value.lower() if isinstance(value, str) else ""
            if low in ("true", "false"):
                field_type = "boolean"
                parsed_value = low == "true"
            elif value.replace(".", "", 1).replace("-", "", 1).isdigit():
                field_type = "number"
                parsed_value = float(value) if "." in value else int(value)

            label = key.replace("_", " ").replace("-", " ").title()
            fields.append({
                "key": key,
                "label": label,
                "section": section_name,
                "type": field_type,
                "value": parsed_value,
                "description": "",
            })
    filename = getattr(config, "filename", "")
    title = filename.replace(".ini", "").replace("User", "").replace("_", " ").title() or filename
    return {
        "filename": filename,
        "title": title,
        "description": f"Configuration from {filename}",
        "fields": fields,
    }


@router.get("/config")
async def list_configs(request: Request) -> dict[str, object]:
    service: ConfigService = request.app.state.config_service
    files = await service.list_configs()
    return {"files": files, "definitions": {name: defs for name, defs in ((file, service.get_field_definitions(file)) for file in files)}}


@router.get("/config/{filename}")
async def get_config(filename: str, request: Request) -> dict:
    try:
        config = await request.app.state.config_service.read_config(filename)
        return _config_to_frontend(config)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/config/{filename}")
async def update_config(
    filename: str,
    payload: dict,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        # Frontend sends { "section.key": value } - convert to ConfigUpdate calls
        service: ConfigService = request.app.state.config_service
        for compound_key, value in payload.items():
            if "." not in compound_key:
                continue
            section, key = compound_key.split(".", 1)
            update = ConfigUpdate(filename=filename, section=section, key=key, value=str(value))
            await service.update_config(filename, update, session)
        config = await service.read_config(filename)
        return _config_to_frontend(config)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
