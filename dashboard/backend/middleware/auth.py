from __future__ import annotations

import hmac
import os

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

SAFE_PATHS = {"/api/ping", "/api/health", "/api/public/status"}
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class AdminTokenMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        if not path.startswith("/api") or path in SAFE_PATHS or request.method == "OPTIONS":
            return await call_next(request)

        expected_token = os.getenv("DUNE_ADMIN_TOKEN", "").strip()

        # Read-only requests: allow without auth when no token is configured,
        # or when DUNE_ADMIN_READ_AUTH is not set to "required".
        read_auth_required = os.getenv("DUNE_ADMIN_READ_AUTH", "false").lower() in {
            "1", "true", "yes", "required",
        }
        is_read = request.method == "GET"
        provided_token = request.headers.get("X-Admin-Token", "").strip()

        if is_read and not read_auth_required:
            # Allow unauthenticated read access (dashboard on trusted LAN)
            return await call_next(request)

        if not expected_token:
            return JSONResponse(
                status_code=503,
                content={"detail": "Admin token is not configured."},
            )

        if not hmac.compare_digest(provided_token, expected_token):
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
