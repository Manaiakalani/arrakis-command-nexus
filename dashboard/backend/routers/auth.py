"""Interactive sign-in for the dashboard.

Two authentication paths coexist deliberately:

* **Session cookie** — humans sign in with a username, password and optional
  TOTP code, and receive an opaque ``HttpOnly`` cookie.
* **Shared admin token** — scripts (``smoke-test.sh``, ``shutdown-host.sh``,
  ``update.sh``) and Next.js Server Components keep sending ``X-Admin-Token``.

Until an operator creates the first password-enabled account the dashboard
stays in legacy token-only mode, so upgrading to this version cannot lock
anyone out of their own server. See ``middleware/auth.py`` for enforcement.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from db.database import SessionLocal
from db.models import AdminSession, AdminUser, AuditLog
from middleware.request_utils import get_client_ip
from services import auth_service

router = APIRouter(tags=["auth"])
logger = logging.getLogger(__name__)

MIN_PASSWORD_LENGTH = 12

# Login throttle: a small in-memory sliding window. The dashboard is a
# single-process container, so a shared store would be overkill.
_MAX_ATTEMPTS = 5
_LOCKOUT_SECONDS = 300
_attempts: dict[str, list[float]] = {}


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=1024)
    totp: str | None = Field(default=None, max_length=16)


class SetupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=1024)


class PasswordChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currentPassword: str = Field(min_length=1, max_length=1024)
    newPassword: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=1024)


class MfaActivateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=6, max_length=6)


def _throttle_key(request: Request, username: str) -> str:
    return f"{get_client_ip(request) or 'unknown'}|{username.lower()}"


def _throttled(key: str) -> int:
    """Return the number of seconds the caller must wait, or 0 if allowed."""
    now = time.monotonic()
    recent = [t for t in _attempts.get(key, []) if now - t < _LOCKOUT_SECONDS]
    _attempts[key] = recent
    if len(recent) < _MAX_ATTEMPTS:
        return 0
    return int(_LOCKOUT_SECONDS - (now - recent[0])) + 1


def _record_failure(key: str) -> None:
    _attempts.setdefault(key, []).append(time.monotonic())


def _clear_failures(key: str) -> None:
    _attempts.pop(key, None)


async def _audit(action: str, details: dict, performed_by: str) -> None:
    try:
        async with SessionLocal() as session:
            session.add(AuditLog(action=action, details=details, performed_by=performed_by))
            await session.commit()
    except Exception:  # noqa: BLE001 - auditing must never break sign-in
        logger.exception("Failed to write audit log for %s", action)


def _cookie_kwargs(max_age: int) -> dict:
    # The default deployment binds to 127.0.0.1 over plain HTTP, so Secure
    # cookies would simply never be sent. Operators terminating TLS in front of
    # the dashboard can opt in with DUNE_DASHBOARD_SECURE_COOKIES=true.
    secure = os.getenv("DUNE_DASHBOARD_SECURE_COOKIES", "false").strip().lower() in {"1", "true", "yes", "on"}
    return {
        "httponly": True,
        "samesite": "lax",
        "secure": secure,
        "path": "/",
        "max_age": max_age,
    }


def _public_user(user: AdminUser) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "enabled": user.enabled,
        "mfaEnabled": bool(user.mfa_enabled),
        "lastLogin": user.last_login.isoformat() if user.last_login else None,
    }


async def _current_user(request: Request) -> AdminUser:
    user = getattr(request.state, "admin_user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Not signed in.")
    return user


# ── Status and bootstrap ──────────────────────────────────────────


@router.get("/auth/status")
async def auth_status() -> dict:
    """Public. Tells the login page whether sign-in is live yet and whether the
    first-run setup flow should be offered. Never leaks usernames."""
    configured = await auth_service.has_password_users()
    policy = await auth_service.get_security_policy()
    return {
        "authEnabled": configured,
        "setupRequired": not configured,
        "mfaRequired": bool(policy.get("mfaEnabled", False)),
        "sessionTimeoutMinutes": auth_service.session_timeout_minutes(policy),
    }


@router.post("/auth/setup")
async def auth_setup(payload: SetupRequest, request: Request) -> dict:
    """Create the very first sign-in account.

    Only callable while no password-enabled account exists, and the caller must
    still present a valid ``X-Admin-Token`` — which the auth middleware has
    already checked by the time we get here. That makes the bootstrap window
    safe even if the dashboard is reachable from the LAN: whoever runs setup
    already had full admin rights via the shared token.
    """
    if await auth_service.has_password_users():
        raise HTTPException(status_code=409, detail="Sign-in is already configured.")

    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="Username must not be blank.")

    async with SessionLocal() as session:
        existing = (
            await session.execute(select(AdminUser).where(AdminUser.username == username))
        ).scalar_one_or_none()
        if existing is not None:
            existing.password_hash = auth_service.hash_password(payload.password)
            existing.role = "operator"
            existing.enabled = True
            user_id = existing.id
        else:
            user = AdminUser(
                username=username,
                role="operator",
                enabled=True,
                password_hash=auth_service.hash_password(payload.password),
            )
            session.add(user)
            await session.flush()
            user_id = user.id
        await session.commit()

    logger.warning("SECURITY: initial dashboard sign-in account created username=%s", username)
    auth_service.invalidate_signin_cache()
    await _audit("auth.setup", {"username": username}, performed_by=username)
    return {"status": "ok", "id": user_id, "username": username}


# ── Sign in / out ─────────────────────────────────────────────────


@router.post("/auth/login")
async def auth_login(payload: LoginRequest, request: Request, response: Response) -> dict:
    username = payload.username.strip()
    key = _throttle_key(request, username)
    wait = _throttled(key)
    if wait:
        logger.warning(
            "SECURITY: login throttled username=%s client_ip=%s retry_after=%ss",
            username,
            get_client_ip(request),
            wait,
        )
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again in {wait} seconds.",
            headers={"Retry-After": str(wait)},
        )

    policy = await auth_service.get_security_policy()
    client_ip = get_client_ip(request)
    if not auth_service.ip_allowed(policy, client_ip):
        logger.warning("SECURITY: login blocked by IP allowlist client_ip=%s", client_ip)
        raise HTTPException(status_code=403, detail="Your network is not permitted to sign in.")

    user = await auth_service.get_user_by_username(username)
    if user is None or not user.enabled or not user.password_hash:
        # Spend the same time as a real verification so a missing or
        # credential-less account is indistinguishable from a wrong password.
        auth_service.dummy_verify(payload.password)
        _record_failure(key)
        logger.warning("SECURITY: login failed (unknown user) username=%s client_ip=%s", username, client_ip)
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    if not auth_service.verify_password(payload.password, user.password_hash):
        _record_failure(key)
        logger.warning("SECURITY: login failed (bad password) username=%s client_ip=%s", username, client_ip)
        await _audit("auth.login_failed", {"username": username, "clientIp": client_ip}, performed_by=username)
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    mfa_required = bool(user.mfa_enabled) or bool(policy.get("mfaEnabled", False))
    if mfa_required:
        if not user.mfa_secret:
            # Policy demands MFA but this account never enrolled. Refusing the
            # login is the safe reading of "MFA required".
            logger.warning("SECURITY: login blocked, MFA required but not enrolled username=%s", username)
            raise HTTPException(
                status_code=403,
                detail="Multi-factor authentication is required but not yet set up for this account.",
            )
        if not auth_service.verify_totp(user.mfa_secret, payload.totp):
            _record_failure(key)
            logger.warning("SECURITY: login failed (bad TOTP) username=%s client_ip=%s", username, client_ip)
            raise HTTPException(status_code=401, detail="Invalid authentication code.", headers={"X-MFA-Required": "1"})

    _clear_failures(key)
    timeout = auth_service.session_timeout_minutes(policy)
    token = await auth_service.create_session(
        user.id,
        timeout_minutes=timeout,
        ip_address=client_ip,
        user_agent=request.headers.get("user-agent"),
    )
    response.set_cookie(auth_service.SESSION_COOKIE, token, **_cookie_kwargs(timeout * 60))

    async with SessionLocal() as session:
        row = await session.get(AdminUser, user.id)
        if row is not None:
            row.last_login = datetime.now(timezone.utc)
            await session.commit()

    logger.info("Dashboard sign-in succeeded username=%s client_ip=%s", username, client_ip)
    await _audit("auth.login", {"username": username, "clientIp": client_ip}, performed_by=username)
    return {"status": "ok", "user": _public_user(user), "sessionTimeoutMinutes": timeout}


@router.post("/auth/logout")
async def auth_logout(request: Request, response: Response) -> dict:
    token = request.cookies.get(auth_service.SESSION_COOKIE)
    await auth_service.revoke_session(token)
    response.delete_cookie(auth_service.SESSION_COOKIE, path="/")
    user = getattr(request.state, "admin_user", None)
    if user is not None:
        await _audit("auth.logout", {"username": user.username}, performed_by=user.username)
    return {"status": "ok"}


@router.get("/auth/me")
async def auth_me(request: Request) -> dict:
    """Who the current request is authenticated as. Machine-token callers get
    a synthetic principal so scripts can probe this endpoint too."""
    user = getattr(request.state, "admin_user", None)
    if user is not None:
        return {"authenticated": True, "method": "session", "user": _public_user(user)}
    return {
        "authenticated": True,
        "method": "token",
        "user": {
            "id": None,
            "username": "service-token",
            "role": getattr(request.state, "admin_role", "operator"),
            "enabled": True,
            "mfaEnabled": False,
            "lastLogin": None,
        },
    }


# ── Self-service credential management ────────────────────────────


@router.post("/auth/password")
async def change_password(payload: PasswordChangeRequest, request: Request) -> dict:
    user = await _current_user(request)
    if not auth_service.verify_password(payload.currentPassword, user.password_hash):
        logger.warning("SECURITY: password change rejected (bad current password) username=%s", user.username)
        raise HTTPException(status_code=401, detail="Current password is incorrect.")
    if payload.newPassword == payload.currentPassword:
        raise HTTPException(status_code=422, detail="New password must differ from the current one.")

    # set_password revokes every session for the user, including this one, so
    # the caller is signed out everywhere and must authenticate again.
    await auth_service.set_password(user.id, payload.newPassword)
    await _audit("auth.password_changed", {"username": user.username}, performed_by=user.username)
    return {"status": "ok", "reauthRequired": True}


@router.post("/auth/mfa/enroll")
async def mfa_enroll(request: Request) -> dict:
    """Generate a TOTP secret. It is stored immediately but stays inactive
    until confirmed with a valid code, so a half-finished enrolment cannot lock
    the account."""
    user = await _current_user(request)
    secret = auth_service.generate_totp_secret()
    async with SessionLocal() as session:
        row = await session.get(AdminUser, user.id)
        if row is None:
            raise HTTPException(status_code=404, detail="Account no longer exists.")
        row.mfa_secret = secret
        row.mfa_enabled = False
        await session.commit()
    return {
        "secret": secret,
        "otpauthUrl": auth_service.totp_provisioning_uri(secret, user.username),
    }


@router.post("/auth/mfa/activate")
async def mfa_activate(payload: MfaActivateRequest, request: Request) -> dict:
    user = await _current_user(request)
    if not user.mfa_secret:
        raise HTTPException(status_code=409, detail="Start enrolment before activating.")
    if not auth_service.verify_totp(user.mfa_secret, payload.code):
        raise HTTPException(status_code=401, detail="That code did not match. Check your device clock and try again.")
    async with SessionLocal() as session:
        row = await session.get(AdminUser, user.id)
        if row is None:
            raise HTTPException(status_code=404, detail="Account no longer exists.")
        row.mfa_enabled = True
        await session.commit()
    await _audit("auth.mfa_enabled", {"username": user.username}, performed_by=user.username)
    return {"status": "ok", "mfaEnabled": True}


@router.post("/auth/mfa/disable")
async def mfa_disable(request: Request) -> dict:
    user = await _current_user(request)
    policy = await auth_service.get_security_policy()
    if policy.get("mfaEnabled", False):
        raise HTTPException(
            status_code=403,
            detail="MFA is required by policy and cannot be disabled per account.",
        )
    async with SessionLocal() as session:
        row = await session.get(AdminUser, user.id)
        if row is None:
            raise HTTPException(status_code=404, detail="Account no longer exists.")
        row.mfa_enabled = False
        row.mfa_secret = None
        await session.commit()
    await _audit("auth.mfa_disabled", {"username": user.username}, performed_by=user.username)
    return {"status": "ok", "mfaEnabled": False}


@router.get("/auth/sessions")
async def list_sessions(request: Request) -> list[dict]:
    """Active sessions for the signed-in account, so a user can spot a session
    they do not recognise."""
    user = await _current_user(request)
    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(AdminSession)
                .where(AdminSession.user_id == user.id)
                .order_by(AdminSession.last_seen_at.desc())
            )
        ).scalars().all()
        current = request.cookies.get(auth_service.SESSION_COOKIE)
        current_hash = auth_service._hash_token(current) if current else None
        return [
            {
                "id": row.token_hash[:12],
                "current": row.token_hash == current_hash,
                "createdAt": row.created_at.isoformat() if row.created_at else None,
                "lastSeenAt": row.last_seen_at.isoformat() if row.last_seen_at else None,
                "expiresAt": row.expires_at.isoformat() if row.expires_at else None,
                "ipAddress": row.ip_address,
                "userAgent": row.user_agent,
            }
            for row in rows
        ]


@router.post("/auth/sessions/revoke-all")
async def revoke_all_sessions(request: Request) -> dict:
    user = await _current_user(request)
    await auth_service.revoke_sessions_for_user(user.id)
    await _audit("auth.sessions_revoked", {"username": user.username}, performed_by=user.username)
    return {"status": "ok", "reauthRequired": True}
