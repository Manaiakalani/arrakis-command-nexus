from __future__ import annotations

import csv
import io
import json

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from db.models import AuditLog

router = APIRouter(tags=["audit"])

# Action categories for UI filtering
ACTION_CATEGORIES = {
    "player": ["player_kick", "player_ban_add", "player_ban_remove", "allowlist_add", "allowlist_remove", "player_login", "player_logout"],
    "character": ["item_grant", "solari_grant", "teleport", "character_update", "health_set"],
    "config": ["config_update", "config_drift_accept"],
    "system": ["backup_create", "backup_restore", "announcement_send", "discord_webhook_add", "scheduled_restart", "restart_schedule_update"],
}


@router.get("/audit")
async def list_audit_logs(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    action: str | None = Query(None),
    category: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> dict:
    query = select(AuditLog).order_by(AuditLog.created_at.desc())

    if action:
        query = query.where(AuditLog.action == action)
    elif category and category in ACTION_CATEGORIES:
        query = query.where(AuditLog.action.in_(ACTION_CATEGORIES[category]))

    count_query = select(func.count(AuditLog.id))
    if action:
        count_query = count_query.where(AuditLog.action == action)
    elif category and category in ACTION_CATEGORIES:
        count_query = count_query.where(AuditLog.action.in_(ACTION_CATEGORIES[category]))

    total = (await session.execute(count_query)).scalar_one()
    result = await session.execute(query.offset(offset).limit(limit))
    entries = result.scalars().all()

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "categories": ACTION_CATEGORIES,
        "entries": [
            {
                "id": e.id,
                "action": e.action,
                "details": e.details,
                "performed_by": e.performed_by,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in entries
        ],
    }


@router.get("/audit/summary")
async def audit_summary(session: AsyncSession = Depends(get_session)) -> dict:
    total = (await session.execute(select(func.count(AuditLog.id)))).scalar_one()
    result = await session.execute(
        select(AuditLog.action, func.count(AuditLog.id))
        .group_by(AuditLog.action)
        .order_by(func.count(AuditLog.id).desc())
    )
    by_action = {row[0]: row[1] for row in result.all()}
    return {"total": total, "by_action": by_action}


@router.get("/audit/export")
async def export_audit_logs(
    fmt: str = Query("csv", pattern="^(csv|json)$"),
    category: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """Export audit trail as CSV or JSON (capped at 50,000 rows to prevent OOM)."""
    _EXPORT_LIMIT = 50_000

    query = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(_EXPORT_LIMIT)
    if category and category in ACTION_CATEGORIES:
        query = query.where(AuditLog.action.in_(ACTION_CATEGORIES[category]))

    result = await session.execute(query)
    entries = result.scalars().all()

    def _sanitize_csv(val: str) -> str:
        """Prefix cells that could be interpreted as formulas in spreadsheet apps."""
        if val and val[0] in ('=', '+', '-', '@', '\t', '\r'):
            return f"'{val}"
        return val

    rows = [
        {
            "id": e.id,
            "action": _sanitize_csv(e.action or ""),
            "details": _sanitize_csv(json.dumps(e.details) if e.details else ""),
            "performed_by": _sanitize_csv(e.performed_by or ""),
            "created_at": e.created_at.isoformat() if e.created_at else "",
        }
        for e in entries
    ]

    if fmt == "json":
        body = json.dumps(rows, indent=2)
        return StreamingResponse(
            iter([body]),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=audit-trail.json"},
        )

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=["id", "action", "details", "performed_by", "created_at"])
    writer.writeheader()
    writer.writerows(rows)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=audit-trail.csv"},
    )
