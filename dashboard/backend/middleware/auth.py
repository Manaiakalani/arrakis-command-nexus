from __future__ import annotations

import hmac
import logging
import os

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from middleware.request_utils import get_client_ip, get_sanitized_path

SAFE_PATHS = {"/api/ping", "/api/health", "/api/ready", "/api/v1/health", "/api/v1/ready", "/api/public/status"}
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_TRUE_VALUES = {"1", "true", "yes", "on"}
_REQUIRED_VALUES = _TRUE_VALUES | {"required"}

# Role hierarchy: viewer < editor < operator (backward-compat: "admin" = operator)
ROLE_HIERARCHY = {"viewer": 0, "editor": 1, "operator": 2, "admin": 2}

# Paths that require at least editor role for mutations
EDITOR_PATHS = {"/api/settings", "/api/config", "/api/game-settings", "/api/announce"}

_HTTP_CODE_MAP = {401: "AUTH_ERROR", 403: "FORBIDDEN", 503: "SERVICE_UNAVAILABLE"}

logger = logging.getLogger(__name__)


def resolve_role(role: str | None) -> str:
    """Normalise a role string. Unknown roles default to 'operator' for
    backward compatibility with existing deployments that only use 'admin'."""
    if role and role.lower() in ROLE_HIERARCHY:
        return role.lower()
    return "operator"


def role_level(role: str) -> int:
    """Return the numeric privilege level for a role."""
    return ROLE_HIERARCHY.get(role.lower(), 2)


def check_role_access(role: str, method: str, path: str) -> tuple[int, str] | None:
    """Return an error tuple if the role is insufficient for the request,
    or None if access is allowed."""
    level = role_level(role)

    # Viewers can only read
    if level < 1 and method in MUTATING_METHODS:
        return 403, "Viewer role cannot perform mutations."

    return None


def _auth_error(request: Request) -> tuple[int, str] | None:
    path = request.url.path
    if not path.startswith("/api") or path in SAFE_PATHS or request.method == "OPTIONS":
        return None

    expected_token = os.getenv("DUNE_ADMIN_TOKEN", "").strip()
    read_auth_required = os.getenv("DUNE_ADMIN_READ_AUTH", "true").lower() in _REQUIRED_VALUES
    provided_token = request.headers.get("X-Admin-Token", "").strip()

    # SSE endpoints cannot send headers — accept token from query param
    if not provided_token and path.startswith("/api/events/"):
        provided_token = request.query_params.get("token", "").strip()

    if request.method == "GET" and not read_auth_required:
        return None

    if not expected_token:
        return 503, "Admin token is not configured."

    if not hmac.compare_digest(provided_token, expected_token):
        logger.warning(
            "SECURITY: Admin auth rejected method=%s path=%s client_ip=%s",
            request.method,
            get_sanitized_path(request),
            get_client_ip(request),
        )
        return 401, "Invalid admin token."

    mutations_enabled = os.getenv("DUNE_ADMIN_MUTATIONS_ENABLED", "true").lower() in _TRUE_VALUES
    if request.method in MUTATING_METHODS and not mutations_enabled:
        logger.warning(
            "SECURITY: Mutating API attempt blocked method=%s path=%s client_ip=%s",
            request.method,
            get_sanitized_path(request),
            get_client_ip(request),
        )
        return 403, "Mutating API operations are disabled."

    # Role-based access check via X-Admin-Role header
    admin_role = request.headers.get("X-Admin-Role", "operator")
    role_error = check_role_access(resolve_role(admin_role), request.method, path)
    if role_error is not None:
        logger.warning(
            "SECURITY: Role-based access denied role=%s method=%s path=%s client_ip=%s",
            admin_role,
            request.method,
            get_sanitized_path(request),
            get_client_ip(request),
        )
        return role_error

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
            return JSONResponse(
                status_code=status_code,
                content={"error": {"code": _HTTP_CODE_MAP.get(status_code, "HTTP_ERROR"), "message": detail}},
            )
        return await call_next(request)
