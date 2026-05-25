from typing import Optional

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


@router.get("/characters/{character_id}/inventory")
async def get_inventory(character_id: str, request: Request) -> dict:
    """Get all items in a character's inventories."""
    try:
        return await request.app.state.character_service.get_inventory(character_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Character not found")


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


class GrantItemRequest(BaseModel):
    template_id: str
    stack_size: int = 1
    quality_level: int = 0


@router.post("/characters/{character_id}/grant-item")
async def grant_item(character_id: str, payload: GrantItemRequest, request: Request) -> dict:
    """Grant an item to a character's main inventory."""
    try:
        return await request.app.state.character_service.grant_item(
            character_id,
            template_id=payload.template_id,
            stack_size=payload.stack_size,
            quality_level=payload.quality_level,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Character not found")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


class GrantSolariRequest(BaseModel):
    amount: int


@router.post("/characters/{character_id}/grant-solari")
async def grant_solari(character_id: str, payload: GrantSolariRequest, request: Request) -> dict:
    """Add solari to a character (adds to existing, does not replace)."""
    try:
        return await request.app.state.character_service.grant_solari(
            character_id, amount=payload.amount,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Character not found")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


class SetHealthRequest(BaseModel):
    max_health: float


@router.post("/characters/{character_id}/set-health")
async def set_health(character_id: str, payload: SetHealthRequest, request: Request) -> dict:
    """Set a character's max health."""
    try:
        return await request.app.state.character_service.update_character(
            character_id, {"max_health": payload.max_health},
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Character not found")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc))


@router.get("/items/templates")
async def list_item_templates(request: Request, search: Optional[str] = None) -> dict:
    """List known item template IDs from the database."""
    try:
        return await request.app.state.character_service.list_item_templates(search)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
