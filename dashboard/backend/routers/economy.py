import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(tags=["economy"])


def _alert_to_frontend(alert) -> dict:
    return {
        "id": alert.id,
        "type": alert.alert_type,
        "severity": alert.severity,
        "message": alert.message,
        "details": alert.details,
        "timestamp": alert.timestamp.isoformat(),
        "acknowledged": alert.acknowledged,
    }


@router.get("/economy/summary")
async def get_summary(request: Request) -> dict:
    try:
        return request.app.state.economy_service.get_summary()
    except Exception:
        logger.exception("Failed to get economy summary")
        raise HTTPException(status_code=500, detail="Failed to retrieve economy summary") from None


@router.get("/economy/alerts")
async def get_alerts(request: Request) -> list[dict]:
    try:
        return [_alert_to_frontend(alert) for alert in request.app.state.economy_service.get_alerts()]
    except Exception:
        logger.exception("Failed to get economy alerts")
        raise HTTPException(status_code=500, detail="Failed to retrieve economy alerts") from None


@router.post("/economy/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str, request: Request) -> dict:
    success = request.app.state.economy_service.acknowledge_alert(alert_id)
    if not success:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"status": "ok"}


class ManualAlertRequest(BaseModel):
    type: str = "manual"
    severity: str = "info"
    message: str
    details: dict | None = None


@router.post("/economy/alerts")
async def create_manual_alert(payload: ManualAlertRequest, request: Request) -> dict:
    try:
        alert = request.app.state.economy_service.add_alert(
            payload.type,
            payload.severity,
            payload.message,
            payload.details,
        )
        return _alert_to_frontend(alert)
    except Exception:
        logger.exception("Failed to create economy alert")
        raise HTTPException(status_code=500, detail="Failed to create economy alert") from None
