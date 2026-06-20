from fastapi import APIRouter, Request

router = APIRouter(tags=["chat-guard"])


@router.get("/chat-guard/settings")
async def get_settings(request: Request) -> dict:
    return request.app.state.chat_guard_service.get_settings()


@router.get("/chat-guard/violations")
async def get_violations(request: Request) -> list[dict]:
    return request.app.state.chat_guard_service.get_violations()


@router.delete("/chat-guard/violations")
async def clear_violations(request: Request) -> dict:
    request.app.state.chat_guard_service.violations.clear()
    return {"status": "ok", "message": "Violations cleared"}
