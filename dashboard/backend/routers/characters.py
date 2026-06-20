from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from db.models import AuditLog

router = APIRouter(tags=["characters"])


async def _write_audit(session: AsyncSession, action: str, details: dict, request: Request) -> None:
    session.add(AuditLog(
        action=action,
        details=details,
        performed_by=request.headers.get("X-Admin-User", "dashboard"),
    ))


async def _notify_admin_action(request: Request, action: str, summary: str) -> None:
    """Mirror admin actions (item_grant / teleport / solari_grant / etc.) to
    Discord webhooks subscribed to the system event channel. Best-effort:
    any failure is logged but does not block the audit log or the response."""
    discord_service = getattr(request.app.state, "discord_service", None)
    if discord_service is None:
        return
    try:
        actor = request.headers.get("X-Admin-User", "dashboard")
        await discord_service.enqueue(
            "admin_action",
            f"**{action}** by `{actor}`\n{summary}",
            title="🛠️ Admin Action",
        )
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).exception("Failed to enqueue Discord admin_action")


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
    template_id: str = Field(min_length=1)
    stack_size: int = Field(default=1, ge=1, le=10000)
    quality_level: int = Field(default=0, ge=0, le=10)


@router.post("/characters/{character_id}/grant-item")
async def grant_item(
    character_id: str,
    payload: GrantItemRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Grant an item to a character's main inventory."""
    try:
        result = await request.app.state.character_service.grant_item(
            character_id,
            template_id=payload.template_id,
            stack_size=payload.stack_size,
            quality_level=payload.quality_level,
        )
        await _write_audit(session, "item_grant", {
            "character_id": character_id,
            "template_id": payload.template_id,
            "stack_size": payload.stack_size,
        }, request)
        await session.commit()
        await _notify_admin_action(
            request,
            "item_grant",
            f"Character `{character_id}` granted `{payload.template_id}` ×{payload.stack_size}",
        )
        return result
    except KeyError:
        raise HTTPException(status_code=404, detail="Character not found")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


class GrantSolariRequest(BaseModel):
    amount: int


@router.post("/characters/{character_id}/grant-solari")
async def grant_solari(
    character_id: str,
    payload: GrantSolariRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Add solari to a character (adds to existing, does not replace)."""
    try:
        result = await request.app.state.character_service.grant_solari(
            character_id, amount=payload.amount,
        )
        await _write_audit(session, "solari_grant", {
            "character_id": character_id,
            "amount": payload.amount,
        }, request)
        await session.commit()
        await _notify_admin_action(
            request, "solari_grant",
            f"Character `{character_id}` received {payload.amount} solari",
        )
        return result
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


class TeleportRequest(BaseModel):
    x: float
    y: float
    z: float


@router.post("/characters/{character_id}/teleport")
async def teleport_character(
    character_id: str,
    payload: TeleportRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Teleport a character to specific coordinates. Takes effect on relog."""
    try:
        result = await request.app.state.character_service.teleport(
            character_id, x=payload.x, y=payload.y, z=payload.z,
        )
        await _write_audit(session, "teleport", {
            "character_id": character_id,
            "x": payload.x, "y": payload.y, "z": payload.z,
        }, request)
        await session.commit()
        await _notify_admin_action(
            request, "teleport",
            f"Character `{character_id}` → ({int(payload.x)}, {int(payload.y)}, {int(payload.z)})",
        )
        return result
    except KeyError:
        raise HTTPException(status_code=404, detail="Character not found")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@router.get("/items/templates")
async def list_item_templates(request: Request, search: Optional[str] = None) -> dict:
    """List known item template IDs from the database."""
    try:
        return await request.app.state.character_service.list_item_templates(search)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
