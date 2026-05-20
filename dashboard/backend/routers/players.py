from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from db.models import AllowlistedPlayer, AuditLog, BannedPlayer
from models.allowlist import AllowlistEntry, AllowlistRequest
from models.player import BanEntry, BanRequest, Player

router = APIRouter(tags=["players"])


async def _write_audit(session: AsyncSession, action: str, details: dict[str, object], request: Request) -> None:
    session.add(
        AuditLog(
            action=action,
            details=details,
            performed_by=request.headers.get("X-Admin-User", "dashboard"),
        )
    )


@router.get("/players", response_model=list[Player])
async def list_players(request: Request) -> list[Player]:
    return await request.app.state.postgres_service.get_online_players()


@router.get("/players/bans", response_model=list[BanEntry])
async def list_bans(session: AsyncSession = Depends(get_session)) -> list[BanEntry]:
    result = await session.execute(select(BannedPlayer).order_by(BannedPlayer.banned_at.desc()))
    return [BanEntry.model_validate(entry) for entry in result.scalars().all()]


@router.post("/players/ban", response_model=BanEntry)
async def add_ban(
    payload: BanRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> BanEntry:
    result = await session.execute(select(BannedPlayer).where(BannedPlayer.steam_id == payload.steam_id))
    existing = result.scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Player is already banned.")

    ban_until = datetime.utcnow() + timedelta(hours=payload.duration_hours) if payload.duration_hours else None
    entry = BannedPlayer(
        steam_id=payload.steam_id,
        reason=payload.reason,
        banned_until=ban_until,
        banned_by=request.headers.get("X-Admin-User", "dashboard"),
    )
    session.add(entry)
    await _write_audit(session, "player_ban_add", payload.model_dump(), request)
    await session.commit()
    await session.refresh(entry)
    return BanEntry.model_validate(entry)


@router.delete("/players/ban/{steam_id}")
async def remove_ban(
    steam_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    result = await session.execute(select(BannedPlayer).where(BannedPlayer.steam_id == steam_id))
    entry = result.scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="Ban not found.")
    await session.delete(entry)
    await _write_audit(session, "player_ban_remove", {"steam_id": steam_id}, request)
    await session.commit()
    return {"status": "ok", "steam_id": steam_id}


@router.get("/players/allowlist", response_model=list[AllowlistEntry])
async def list_allowlist(session: AsyncSession = Depends(get_session)) -> list[AllowlistEntry]:
    result = await session.execute(select(AllowlistedPlayer).order_by(AllowlistedPlayer.added_at.desc()))
    return [AllowlistEntry.model_validate(entry) for entry in result.scalars().all()]


@router.post("/players/allowlist", response_model=AllowlistEntry)
async def add_allowlist(
    payload: AllowlistRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> AllowlistEntry:
    result = await session.execute(select(AllowlistedPlayer).where(AllowlistedPlayer.steam_id == payload.steam_id))
    existing = result.scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Player already exists in allowlist.")

    entry = AllowlistedPlayer(steam_id=payload.steam_id, player_name=payload.player_name)
    session.add(entry)
    await _write_audit(session, "allowlist_add", payload.model_dump(), request)
    await session.commit()
    await session.refresh(entry)
    return AllowlistEntry.model_validate(entry)
