from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from db.models import AllowlistedPlayer, AuditLog, BannedPlayer
from models.allowlist import AllowlistEntry, AllowlistRequest
from models.player import BanEntry, BanRequest

router = APIRouter(tags=["players"])


async def _write_audit(session: AsyncSession, action: str, details: dict[str, object], request: Request) -> None:
    session.add(
        AuditLog(
            action=action,
            details=details,
            performed_by=request.headers.get("X-Admin-User", "dashboard"),
        )
    )


def _player_to_frontend(p) -> dict:
    """Convert backend Player model to frontend expected shape."""
    session_seconds = 0
    if p.session_start:
        try:
            start = p.session_start
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            session_seconds = max(0, int((datetime.now(timezone.utc) - start).total_seconds()))
        except Exception:
            pass
    return {
        "name": p.name or "Unknown",
        "steamId": p.steam_id,
        "map": p.map_name or "Unknown",
        "map_name": p.map_name,
        "sessionSeconds": session_seconds,
        "position": p.position,
        "x": p.position.get("x") if p.position else None,
        "y": p.position.get("y") if p.position else None,
    }


def _ban_to_frontend(entry) -> dict:
    """Convert backend BanEntry/BannedPlayer to frontend expected shape."""
    banned_at = getattr(entry, "banned_at", None)
    banned_until = getattr(entry, "banned_until", None)
    return {
        "steamId": getattr(entry, "steam_id", ""),
        "playerName": getattr(entry, "player_name", None),
        "reason": getattr(entry, "reason", ""),
        "durationHours": None,
        "bannedAt": banned_at.isoformat() if banned_at else datetime.now(timezone.utc).isoformat(),
        "expiresAt": banned_until.isoformat() if banned_until else None,
        "active": banned_until is None or banned_until > datetime.now(timezone.utc) if banned_until else True,
    }


@router.get("/players")
async def list_players(request: Request) -> list[dict]:
    players = await request.app.state.postgres_service.get_online_players()
    return [_player_to_frontend(p) for p in players]


@router.get("/players/bans")
async def list_bans(session: AsyncSession = Depends(get_session)) -> list[dict]:
    result = await session.execute(select(BannedPlayer).order_by(BannedPlayer.banned_at.desc()))
    return [_ban_to_frontend(entry) for entry in result.scalars().all()]


class FrontendBanRequest(BaseModel):
    steamId: str | None = None
    steam_id: str | None = None
    reason: str = "Rule violation"
    duration: int | None = None
    duration_hours: int | None = None


@router.post("/players/bans")
@router.post("/players/ban")
async def add_ban(
    payload: FrontendBanRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    sid = payload.steamId or payload.steam_id
    if not sid:
        raise HTTPException(status_code=422, detail="steamId is required")
    dur = payload.duration or payload.duration_hours

    result = await session.execute(select(BannedPlayer).where(BannedPlayer.steam_id == sid))
    existing = result.scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Player is already banned.")

    ban_until = datetime.utcnow() + timedelta(hours=dur) if dur else None
    entry = BannedPlayer(
        steam_id=sid,
        reason=payload.reason,
        banned_until=ban_until,
        banned_by=request.headers.get("X-Admin-User", "dashboard"),
    )
    session.add(entry)
    await _write_audit(session, "player_ban_add", {"steam_id": sid, "reason": payload.reason}, request)
    await session.commit()
    await session.refresh(entry)
    return _ban_to_frontend(entry)


@router.delete("/players/bans/{steam_id}")
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
