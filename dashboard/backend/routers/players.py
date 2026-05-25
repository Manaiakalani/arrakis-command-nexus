from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from db.models import AllowlistedPlayer, AuditLog, BannedPlayer, ConnectionLog
from models.allowlist import AllowlistEntry, AllowlistRequest

router = APIRouter(tags=["players"])


async def _write_audit(session: AsyncSession, action: str, details: dict[str, object], request: Request) -> None:
    session.add(
        AuditLog(
            action=action,
            details=details,
            performed_by=request.headers.get("X-Admin-User", "dashboard"),
        )
    )


def _compute_session_seconds(p) -> int:
    if not p.session_start:
        return 0
    try:
        start = p.session_start
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        return max(0, int((datetime.now(timezone.utc) - start).total_seconds()))
    except Exception:
        return 0


def _player_to_frontend(p) -> dict:
    """Convert backend Player model to frontend expected shape."""
    return {
        "name": p.name or "Unknown",
        "steamId": p.steam_id,
        "map": p.map_name or "Unknown",
        "map_name": p.map_name,
        "sessionSeconds": _compute_session_seconds(p),
        "position": p.position,
        "x": p.position.get("x") if p.position else None,
        "y": p.position.get("y") if p.position else None,
        "z": p.position.get("z") if p.position else None,
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


@router.get("/players/positions")
async def get_player_positions(request: Request) -> list[dict]:
    """Get player positions optimized for map rendering."""
    players = await request.app.state.postgres_service.get_online_players()
    return [
        {
            "name": p.name or "Unknown",
            "steamId": p.steam_id,
            "map": p.map_name or "Unknown",
            "x": p.position.get("x") if p.position else None,
            "y": p.position.get("y") if p.position else None,
            "z": p.position.get("z") if p.position else None,
            "sessionSeconds": _compute_session_seconds(p),
        }
        for p in players
    ]


class KickRequest(BaseModel):
    steamId: str | None = None
    steam_id: str | None = None
    reason: str = "Kicked by admin"


@router.post("/players/kick")
async def kick_player(
    payload: KickRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    sid = payload.steamId or payload.steam_id
    if not sid:
        raise HTTPException(status_code=422, detail="steamId is required")

    docker_service = request.app.state.docker_service
    success = await docker_service.kick_player(sid)

    await _write_audit(session, "player_kick", {"steam_id": sid, "reason": payload.reason}, request)
    await session.commit()

    return {
        "status": "ok" if success else "failed",
        "steamId": sid,
        "message": f"Player {sid} kicked" if success else "Kick command sent but player may not have been found",
    }


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

    ban_until = datetime.now(timezone.utc) + timedelta(hours=dur) if dur else None
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


# ---------------------------------------------------------------------------
# Connection History
# ---------------------------------------------------------------------------

@router.get("/players/connections")
async def list_connections(
    limit: int = 200,
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    result = await session.execute(
        select(ConnectionLog)
        .order_by(ConnectionLog.timestamp.desc())
        .limit(min(limit, 1000))
    )
    return [
        {
            "id": row.id,
            "steamId": row.steam_id,
            "playerName": row.player_name,
            "event": row.event,
            "mapName": row.map_name,
            "timestamp": row.timestamp.isoformat() if row.timestamp else None,
        }
        for row in result.scalars().all()
    ]


@router.get("/players/connections/export")
async def export_connections(
    format: str = "csv",
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    result = await session.execute(
        select(ConnectionLog).order_by(ConnectionLog.timestamp.desc()).limit(5000)
    )
    rows = result.scalars().all()

    import csv
    import io
    import json as json_mod

    if format == "json":
        data = [
            {
                "steamId": r.steam_id,
                "playerName": r.player_name,
                "event": r.event,
                "mapName": r.map_name,
                "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            }
            for r in rows
        ]
        content = json_mod.dumps(data, indent=2)
        return StreamingResponse(
            io.BytesIO(content.encode()),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=connection_history.json"},
        )

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Steam ID", "Player Name", "Event", "Map", "Timestamp"])
    for r in rows:
        writer.writerow([
            r.steam_id,
            r.player_name or "",
            r.event,
            r.map_name or "",
            r.timestamp.isoformat() if r.timestamp else "",
        ])
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=connection_history.csv"},
    )
