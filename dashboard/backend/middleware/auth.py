from __future__ import annotations

import hmac
import os

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

SAFE_PATHS = {"/api/ping", "/api/health", "/api/public/status"}
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_TRUE_VALUES = {"1", "true", "yes", "on"}
_REQUIRED_VALUES = _TRUE_VALUES | {"required"}


def _auth_error(request: Request) -> tuple[int, str] | None:
    path = request.url.path
    if not path.startswith("/api") or path in SAFE_PATHS or request.method == "OPTIONS":
        return None

    expected_token = os.getenv("DUNE_ADMIN_TOKEN", "").strip()
    read_auth_required = os.getenv("DUNE_ADMIN_READ_AUTH", "false").lower() in _REQUIRED_VALUES
    provided_token = request.headers.get("X-Admin-Token", "").strip()

    if request.method == "GET" and not read_auth_required:
        return None

    if not expected_token:
        return 503, "Admin token is not configured."

    if not hmac.compare_digest(provided_token, expected_token):
        return 401, "Invalid admin token."

    mutations_enabled = os.getenv("DUNE_ADMIN_MUTATIONS_ENABLED", "true").lower() in _TRUE_VALUES
    if request.method in MUTATING_METHODS and not mutations_enabled:
        return 403, "Mutating API operations are disabled."

    return None


async def verify_admin_token(request: Request) -> None:
    error = _auth_error(request)
    if error is None:
        return
    status_code, detail = error
    raise HTTPException(status_code=status_code, detail=detail)


class AdminTokenMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        error = _auth_error(request)
        if error is not None:
            status_code, detail = error
            return JSONResponse(status_code=status_code, content={"detail": detail})
        return await call_next(request)
