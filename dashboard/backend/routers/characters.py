from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(tags=["characters"])


@router.get("/characters")
async def list_characters(request: Request) -> list[dict]:
    return await request.app.state.character_service.list_characters()


@router.get("/characters/stats-schema")
async def get_stats_schema(request: Request) -> dict:
    service = request.app.state.character_service
    return {
        "stats": service.get_editable_stats(),
        "summary": service.get_summary(),
    }


@router.get("/characters/{character_id}")
async def get_character(character_id: str, request: Request) -> dict:
    char = await request.app.state.character_service.get_character(character_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    return char


class CharacterUpdateRequest(BaseModel):
    updates: dict


@router.put("/characters/{character_id}")
async def update_character(character_id: str, payload: CharacterUpdateRequest, request: Request) -> dict:
    try:
        return await request.app.state.character_service.update_character(character_id, payload.updates)
    except KeyError:
        raise HTTPException(status_code=404, detail="Character not found")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc))
