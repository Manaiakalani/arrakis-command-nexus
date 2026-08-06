from __future__ import annotations

import hmac
import logging
import os
import re

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from middleware.request_utils import get_client_ip, get_sanitized_path
from services import auth_service

SAFE_PATHS = {"/api/ping", "/api/health", "/api/ready", "/api/v1/health", "/api/v1/ready", "/api/public/status"}
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_TRUE_VALUES = {"1", "true", "yes", "on"}
_REQUIRED_VALUES = _TRUE_VALUES | {"required"}

# Endpoints that must work before a session exists. Matched as suffixes so the
# /api and /api/v1 aliases are both covered. /auth/setup is deliberately absent:
# bootstrapping the first account still requires the shared admin token.
PUBLIC_AUTH_SUFFIXES = ("/auth/status", "/auth/login", "/auth/session-check")

# The frontend container calls /auth/session-check server-side on every request
# to decide whether a caller is signed in, so the backend sees the container's
# address rather than the browser's. Subjecting it to the IP allowlist would
# make it fail for every deployment whose allowlist does not happen to include
# the Docker bridge address -- and a frontend that cannot reach it has no way to
# tell "sign-in is off" from "the check is broken". It reveals only whether
# sign-in is configured and whether a cookie the caller already holds is valid.
_ALLOWLIST_EXEMPT_SUFFIXES = ("/auth/session-check",)

# Signing out, changing your own password and managing your own MFA are not
# privileged operations, even though they are POSTs. Without this a viewer could
# not end their own session or rotate a compromised password.
_SELF_SERVICE_AUTH_SUFFIXES = (
    "/auth/logout",
    "/auth/password",
    "/auth/mfa/enroll",
    "/auth/mfa/activate",
    "/auth/mfa/disable",
    "/auth/sessions/revoke-all",
)

# Role hierarchy: viewer < editor < operator (backward-compat: "admin" = operator)
ROLE_HIERARCHY = {"viewer": 0, "editor": 1, "operator": 2, "admin": 2}

# Mutations matching these patterns take the server up, down or sideways, or
# touch credentials and security policy, so they require the full operator role.
# Everything else a non-viewer may change (config files, announcements, player
# moderation, characters, economy) needs only editor.
#
# These are anchored patterns rather than substrings: a bare `in path` test
# silently missed real operator routes such as /restart/now and
# /system/prepare-shutdown, which let editors restart the server.
_OPERATOR_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"/backups(/|$)",
        r"/updates(/|$)",
        r"/watchdog(/|$)",
        r"/system/(power|restart|shutdown|prepare-shutdown|resources)(/|$)",
        r"/restart/(schedule|now)(/|$)",
        r"/restart-schedule(/|$)",
        r"/settings/admins(/|$)",
        r"/settings/(security|integrations|steam-account)(/|$)",
        r"/settings/import(/|$)",
        # Service and whole-server lifecycle actions, e.g. /services/x/restart
        r"/services/[^/]+/[^/]+$",
        r"/server/[^/]+$",
        r"/maps/[^/]+/(start|stop|restart|backup)$",
    )
)

_HTTP_CODE_MAP = {401: "AUTH_ERROR", 403: "FORBIDDEN", 429: "RATE_LIMITED", 503: "SERVICE_UNAVAILABLE"}

logger = logging.getLogger(__name__)


def is_operator_path(path: str) -> bool:
    """True when the path is reserved for the operator role."""
    return any(pattern.search(path) for pattern in _OPERATOR_PATTERNS)



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

    if method not in MUTATING_METHODS:
        return None

    # Managing your own credentials is never a privileged operation.
    if any(path.endswith(suffix) for suffix in _SELF_SERVICE_AUTH_SUFFIXES):
        return None

    # Viewers can only read
    if level < 1:
        return 403, "Viewer role cannot perform mutations."

    # Editors can change configuration but not run privileged operations
    if level < 2 and is_operator_path(path):
        return 403, "Operator role is required for this operation."

    return None


async def _auth_error(request: Request) -> tuple[int, str] | None:
    path = request.url.path
    if not path.startswith("/api") or path in SAFE_PATHS or request.method == "OPTIONS":
        return None

    policy = await auth_service.get_security_policy()

    # The IP allowlist gates everything under /api, session or token alike. It
    # is checked first so a blocked network learns nothing about credentials.
    client_ip = get_client_ip(request)
    allowlist_exempt = any(path.endswith(suffix) for suffix in _ALLOWLIST_EXEMPT_SUFFIXES)
    if not allowlist_exempt and not auth_service.ip_allowed(policy, client_ip):
        logger.warning(
            "SECURITY: request blocked by IP allowlist method=%s path=%s client_ip=%s",
            request.method,
            get_sanitized_path(request),
            client_ip,
        )
        return 403, "Your network is not permitted to access this dashboard."

    # /auth/status and /auth/login must be reachable before you have a session.
    # Both are rate limited and allowlisted in the router itself.
    if any(path.endswith(suffix) for suffix in PUBLIC_AUTH_SUFFIXES):
        return None

    signin_configured = await auth_service.has_password_users()

    # ── Session cookie ────────────────────────────────────────────
    session_token = request.cookies.get(auth_service.SESSION_COOKIE)
    if session_token:
        timeout_minutes = auth_service.session_timeout_minutes(policy)
        user = await auth_service.resolve_session(session_token, timeout_minutes=timeout_minutes)
        if user is not None:
            role = resolve_role(user.role)
            request.state.admin_user = user
            request.state.admin_role = role
            # The DB expiry slides on every request, so slide the browser's
            # copy too. Without this the cookie still lapses at the max_age set
            # at login and an active user is signed out mid-session.
            request.state.session_refresh = (session_token, timeout_minutes * 60)
            return _post_auth_checks(request, role, path)
        if signin_configured:
            logger.info(
                "Rejecting stale or expired dashboard session path=%s client_ip=%s",
                get_sanitized_path(request),
                client_ip,
            )
            return 401, "Your session has expired. Please sign in again."

    expected_token = os.getenv("DUNE_ADMIN_TOKEN", "").strip()
    read_auth_required = os.getenv("DUNE_ADMIN_READ_AUTH", "true").lower() in _REQUIRED_VALUES
    provided_token = request.headers.get("X-Admin-Token", "").strip()

    # SSE endpoints cannot send headers — accept token from query param
    if not provided_token and path.startswith("/api/events/"):
        provided_token = request.query_params.get("token", "").strip()

    # Reads may be open when the operator has explicitly opted out of read auth,
    # but only while nobody has configured real sign-in. Once accounts exist,
    # honouring this flag would silently undo the login requirement.
    if request.method == "GET" and not read_auth_required and not signin_configured:
        return None

    if not expected_token:
        return 503, "Admin token is not configured."

    if not hmac.compare_digest(provided_token, expected_token):
        logger.warning(
            "SECURITY: Admin auth rejected method=%s path=%s client_ip=%s",
            request.method,
            get_sanitized_path(request),
            client_ip,
        )
        if signin_configured:
            return 401, "Sign in to continue."
        return 401, "Invalid admin token."

    # A valid shared token is a service credential: it always acts as an
    # operator and never honours a client-supplied role header.
    request.state.admin_role = "operator"
    return _post_auth_checks(request, "operator", path)


def _post_auth_checks(request: Request, role: str, path: str) -> tuple[int, str] | None:
    """Checks applied once the caller is authenticated, whichever method used."""
    mutations_enabled = os.getenv("DUNE_ADMIN_MUTATIONS_ENABLED", "true").lower() in _TRUE_VALUES
    if request.method in MUTATING_METHODS and not mutations_enabled:
        logger.warning(
            "SECURITY: Mutating API attempt blocked method=%s path=%s client_ip=%s",
            request.method,
            get_sanitized_path(request),
            get_client_ip(request),
        )
        return 403, "Mutating API operations are disabled."

    role_error = check_role_access(role, request.method, path)
    if role_error is not None:
        logger.warning(
            "SECURITY: Role-based access denied role=%s method=%s path=%s client_ip=%s",
            role,
            request.method,
            get_sanitized_path(request),
            get_client_ip(request),
        )
        return role_error

    return None


async def verify_admin_token(request: Request) -> None:
    error = await _auth_error(request)
    if error is None:
        return
    status_code, detail = error
    raise HTTPException(status_code=status_code, detail=detail)


class AdminTokenMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        error = await _auth_error(request)
        if error is not None:
            status_code, detail = error
            return JSONResponse(
                status_code=status_code,
                content={"error": {"code": _HTTP_CODE_MAP.get(status_code, "HTTP_ERROR"), "message": detail}},
            )
        response = await call_next(request)

        # Keep the browser cookie's lifetime in step with the sliding server
        # session, unless the handler already set the cookie itself (login,
        # logout, password change).
        refresh = getattr(request.state, "session_refresh", None)
        if refresh is not None and "set-cookie" not in response.headers:
            token, max_age = refresh
            response.set_cookie(auth_service.SESSION_COOKIE, token, **auth_service.cookie_kwargs(max_age))
        return response
