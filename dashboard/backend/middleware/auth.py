from __future__ import annotations

import os

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

SAFE_PATHS = {"/api/ping", "/api/health"}
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class AdminTokenMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        if not path.startswith("/api") or path in SAFE_PATHS or request.method == "OPTIONS":
            return await call_next(request)

        expected_token = os.getenv("DUNE_ADMIN_TOKEN", "").strip()
        if not expected_token:
            return JSONResponse(
                status_code=503,
                content={"detail": "Admin token is not configured."},
            )

        provided_token = request.headers.get("X-Admin-Token", "").strip()
        if provided_token != expected_token:
            return JSONResponse(status_code=401, content={"detail": "Invalid admin token."})

        mutations_enabled = os.getenv("DUNE_ADMIN_MUTATIONS_ENABLED", "true").lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        if request.method in MUTATING_METHODS and not mutations_enabled:
            return JSONResponse(
                status_code=403,
                content={"detail": "Mutating API operations are disabled."},
            )

        return await call_next(request)
