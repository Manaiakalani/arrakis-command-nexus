from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

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
    return request.app.state.economy_service.get_summary()


@router.get("/economy/alerts")
async def get_alerts(request: Request) -> list[dict]:
    return [_alert_to_frontend(alert) for alert in request.app.state.economy_service.get_alerts()]


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
    alert = request.app.state.economy_service.add_alert(
        payload.type,
        payload.severity,
        payload.message,
        payload.details,
    )
    return _alert_to_frontend(alert)
