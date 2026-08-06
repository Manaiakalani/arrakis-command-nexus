"""Credential, MFA and session primitives for dashboard sign-in.

Everything here is deliberately built on the Python standard library. The
dashboard ships as a self-hosted container on constrained hardware, and adding
passlib/bcrypt/pyotp would pull compiled dependencies into an image that is
currently pure-Python. ``hashlib.scrypt`` (OpenSSL-backed, memory-hard) and a
~40 line RFC 6238 implementation cover the same ground.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import string
import struct
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from db.database import SessionLocal
from db.models import AdminSession, AdminUser

logger = logging.getLogger(__name__)

# scrypt work factors. n=2**14 with r=8 needs ~16 MB per hash, which keeps
# sign-in comfortably under 100 ms on the Pi-class hardware this runs on while
# staying far outside GPU-friendly territory.
_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 32

SESSION_COOKIE = "dune_session"
_SESSION_TOKEN_BYTES = 32


def cookie_kwargs(max_age: int) -> dict:
    """Shared cookie settings for the session cookie.

    The default deployment binds to 127.0.0.1 over plain HTTP, so ``Secure``
    cookies would simply never be sent. Operators terminating TLS in front of
    the dashboard opt in with ``DUNE_DASHBOARD_SECURE_COOKIES=true``.
    """
    secure = os.getenv("DUNE_DASHBOARD_SECURE_COOKIES", "false").strip().lower() in {"1", "true", "yes", "on"}
    return {
        "httponly": True,
        "samesite": "lax",
        "secure": secure,
        "path": "/",
        "max_age": max_age,
    }


# Canonical defaults for the "security" settings blob. Defined here rather than
# in routers/settings.py so the middleware can read the policy without importing
# a router (services -> routers would invert the dependency direction).
SECURITY_DEFAULTS: dict = {
    "sessionTimeoutMinutes": 60,
    "mfaEnabled": False,
    "ipAllowlist": [],
}

_POLICY_TTL_SECONDS = 10.0
_policy_cache: tuple[float, dict] | None = None
_signin_cache: tuple[float, bool] | None = None

# A dummy hash to verify against when the username does not exist, so that a
# missing user and a wrong password take the same amount of time.
_DUMMY_HASH: str | None = None


# ── Password hashing ──────────────────────────────────────────────


def hash_password(password: str) -> str:
    """Hash a password with scrypt. Returns a self-describing string so the
    work factors can be raised later without invalidating existing hashes."""
    if not password:
        raise ValueError("Password must not be empty.")
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_DKLEN,
    )
    return "$".join(
        [
            "scrypt",
            str(_SCRYPT_N),
            str(_SCRYPT_R),
            str(_SCRYPT_P),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(derived).decode("ascii"),
        ]
    )


def verify_password(password: str, stored: str | None) -> bool:
    """Constant-time password check. Returns False for malformed or absent
    hashes rather than raising, so a corrupt row cannot 500 the login route."""
    if not password or not stored:
        return False
    try:
        scheme, n_raw, r_raw, p_raw, salt_b64, hash_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=base64.b64decode(salt_b64),
            n=int(n_raw),
            r=int(r_raw),
            p=int(p_raw),
            dklen=len(base64.b64decode(hash_b64)),
        )
    except (ValueError, TypeError, MemoryError):
        logger.warning("Stored password hash is malformed; rejecting login.")
        return False
    return hmac.compare_digest(derived, base64.b64decode(hash_b64))


def dummy_verify(password: str) -> None:
    """Burn roughly one scrypt round so that logins for unknown usernames take
    as long as logins for real ones. Prevents user enumeration by timing."""
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
    verify_password(password or "x", _DUMMY_HASH)


# ── TOTP (RFC 6238) ───────────────────────────────────────────────


def generate_totp_secret() -> str:
    """Return a fresh base32 TOTP secret suitable for authenticator apps."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _totp_at(secret: str, counter: int) -> str:
    padding = "=" * (-len(secret) % 8)
    try:
        key = base64.b32decode(secret.upper() + padding, casefold=True)
    except (ValueError, TypeError):
        return ""
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{code % 1_000_000:06d}"


def verify_totp(secret: str | None, code: str | None, *, window: int = 1) -> bool:
    """Validate a 6-digit TOTP code, tolerating +/- one 30s step of clock skew."""
    if not secret or not code:
        return False
    cleaned = code.strip().replace(" ", "")
    if not cleaned.isdigit() or len(cleaned) != 6:
        return False
    counter = int(time.time()) // 30
    for drift in range(-window, window + 1):
        candidate = _totp_at(secret, counter + drift)
        if candidate and hmac.compare_digest(candidate, cleaned):
            return True
    return False


def totp_provisioning_uri(secret: str, username: str, issuer: str = "Arrakis Command Nexus") -> str:
    """Build the otpauth:// URI an authenticator app scans."""
    from urllib.parse import quote

    label = quote(f"{issuer}:{username}", safe="")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer, safe='')}&algorithm=SHA1&digits=6&period=30"


# ── Sessions ──────────────────────────────────────────────────────


def _hash_token(token: str) -> str:
    """Sessions are stored hashed so a database leak does not hand over live
    sessions, exactly as we would treat a password."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# A session token is `secrets.token_urlsafe(32)`: 43 characters of the URL-safe
# base64 alphabet. Anything else cannot be one, so it is rejected before the
# database is touched. /auth/session-check is reachable from outside the IP
# allowlist by design, and this keeps a flood of junk cookies from turning into
# a flood of primary-key lookups.
_SESSION_TOKEN_CHARS = frozenset(string.ascii_letters + string.digits + "-_")
_SESSION_TOKEN_LENGTH = len(secrets.token_urlsafe(_SESSION_TOKEN_BYTES))


def _plausible_session_token(token: str | None) -> bool:
    return bool(token) and len(token) == _SESSION_TOKEN_LENGTH and set(token) <= _SESSION_TOKEN_CHARS


async def create_session(
    user_id: int,
    *,
    timeout_minutes: int,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> str:
    """Create a session row and return the opaque token to hand to the client.
    Only the hash is persisted; the plaintext token exists solely in the cookie."""
    token = secrets.token_urlsafe(_SESSION_TOKEN_BYTES)
    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        session.add(
            AdminSession(
                token_hash=_hash_token(token),
                user_id=user_id,
                created_at=now,
                last_seen_at=now,
                expires_at=now + timedelta(minutes=max(1, timeout_minutes)),
                ip_address=(ip_address or "")[:64] or None,
                user_agent=(user_agent or "")[:255] or None,
            )
        )
        await session.commit()
    return token


async def resolve_session(token: str | None, *, timeout_minutes: int) -> AdminUser | None:
    """Look up the user behind a session token, sliding the expiry window
    forward on success. Returns None for unknown, expired or disabled users."""
    if not _plausible_session_token(token):
        return None
    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        row = await session.get(AdminSession, _hash_token(token))
        if row is None:
            return None
        expires_at = _as_aware(row.expires_at)
        if expires_at is not None and expires_at <= now:
            await session.delete(row)
            await session.commit()
            logger.info("Expired dashboard session pruned for user_id=%s", row.user_id)
            return None
        user = await session.get(AdminUser, row.user_id)
        if user is None or not user.enabled:
            await session.delete(row)
            await session.commit()
            return None
        snapshot = _snapshot(user)
        # Slide the window at most once a minute. Polling widgets and SSE
        # reconnects would otherwise write to the database on every request.
        last_seen = _as_aware(row.last_seen_at)
        if last_seen is None or (now - last_seen).total_seconds() > 60:
            row.last_seen_at = now
            row.expires_at = now + timedelta(minutes=max(1, timeout_minutes))
            await session.commit()
        # Return a detached snapshot so callers can read attributes after the
        # session closes without tripping lazy-load on an expired instance.
        return snapshot


async def revoke_session(token: str | None) -> None:
    if not token:
        return
    async with SessionLocal() as session:
        row = await session.get(AdminSession, _hash_token(token))
        if row is not None:
            await session.delete(row)
            await session.commit()


async def revoke_sessions_for_user(user_id: int) -> None:
    """Drop every session for a user. Called when they are disabled, deleted,
    or have their password or role changed."""
    async with SessionLocal() as session:
        await session.execute(delete(AdminSession).where(AdminSession.user_id == user_id))
        await session.commit()


async def purge_expired_sessions() -> int:
    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        result = await session.execute(delete(AdminSession).where(AdminSession.expires_at <= now))
        await session.commit()
        return result.rowcount or 0


# ── User helpers ──────────────────────────────────────────────────


def _as_aware(value: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes even for timezone=True columns."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _snapshot(user: AdminUser) -> AdminUser:
    clone = AdminUser()
    clone.id = user.id
    clone.username = user.username
    clone.role = user.role
    clone.enabled = user.enabled
    clone.password_hash = user.password_hash
    clone.mfa_secret = user.mfa_secret
    clone.mfa_enabled = user.mfa_enabled
    clone.created_at = user.created_at
    clone.last_login = user.last_login
    return clone


async def get_user_by_username(username: str) -> AdminUser | None:
    async with SessionLocal() as session:
        row = (
            await session.execute(select(AdminUser).where(AdminUser.username == username))
        ).scalar_one_or_none()
        return _snapshot(row) if row is not None else None


async def has_password_users() -> bool:
    """True once at least one enabled account can actually sign in. Until then
    the dashboard stays in legacy shared-token mode so upgrades never lock the
    operator out of their own server.

    Cached briefly: the auth middleware calls this on every request.
    """
    global _signin_cache
    now = time.monotonic()
    if _signin_cache is not None and now - _signin_cache[0] < _POLICY_TTL_SECONDS:
        return _signin_cache[1]

    async with SessionLocal() as session:
        row = (
            await session.execute(
                select(AdminUser.id)
                .where(AdminUser.password_hash.is_not(None))
                .where(AdminUser.enabled.is_(True))
                .limit(1)
            )
        ).first()
        configured = row is not None

    _signin_cache = (now, configured)
    return configured


def invalidate_signin_cache() -> None:
    """Called after setup or an admin-user change so the new state is visible
    immediately rather than up to the cache TTL later."""
    global _signin_cache
    _signin_cache = None


async def set_password(user_id: int, password: str) -> None:
    async with SessionLocal() as session:
        user = await session.get(AdminUser, user_id)
        if user is None:
            raise KeyError(f"Admin user {user_id} not found")
        user.password_hash = hash_password(password)
        await session.commit()
    await revoke_sessions_for_user(user_id)


# ── Security policy ───────────────────────────────────────────────


def invalidate_security_policy() -> None:
    """Drop the cached policy so a settings save takes effect immediately."""
    global _policy_cache
    _policy_cache = None


async def get_security_policy() -> dict:
    """Read the persisted security settings, merged over defaults. Cached for a
    few seconds because the auth middleware consults this on every request."""
    global _policy_cache
    now = time.monotonic()
    if _policy_cache is not None and now - _policy_cache[0] < _POLICY_TTL_SECONDS:
        return _policy_cache[1]

    merged = dict(SECURITY_DEFAULTS)
    try:
        from db.models import DashboardSetting

        async with SessionLocal() as session:
            row = await session.get(DashboardSetting, "security")
            if row is not None and isinstance(row.value, dict):
                merged.update(row.value)
    except Exception:  # noqa: BLE001 - policy must never take the API down
        logger.exception("Failed to load security policy; falling back to defaults.")
        return merged

    _policy_cache = (now, merged)
    return merged


def session_timeout_minutes(policy: dict) -> int:
    raw = policy.get("sessionTimeoutMinutes", SECURITY_DEFAULTS["sessionTimeoutMinutes"])
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return int(SECURITY_DEFAULTS["sessionTimeoutMinutes"])
    # Clamp to something sane: a zero or negative timeout would expire sessions
    # instantly and lock everyone out; a year-long one defeats the setting.
    return max(1, min(value, 60 * 24 * 30))


def ip_allowed(policy: dict, client_ip: str | None) -> bool:
    """Check a client IP against the configured allowlist. An empty allowlist
    means 'no restriction'. Entries may be plain addresses or CIDR ranges."""
    entries = policy.get("ipAllowlist") or []
    if not isinstance(entries, list) or not entries:
        return True
    if not client_ip:
        return False

    import ipaddress

    try:
        address = ipaddress.ip_address(client_ip.strip())
    except ValueError:
        return False

    for raw in entries:
        candidate = str(raw or "").strip()
        if not candidate:
            continue
        try:
            if "/" in candidate:
                if address in ipaddress.ip_network(candidate, strict=False):
                    return True
            elif address == ipaddress.ip_address(candidate):
                return True
        except ValueError:
            logger.warning("Ignoring malformed IP allowlist entry: %r", candidate)
            continue
    return False
