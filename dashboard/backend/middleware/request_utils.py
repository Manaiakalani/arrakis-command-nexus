from __future__ import annotations

from starlette.requests import Request

from middleware.redaction import redact_url


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip() or "unknown"

    real_ip = request.headers.get("X-Real-IP", "").strip()
    if real_ip:
        return real_ip

    if request.client and request.client.host:
        return request.client.host

    return "unknown"


def get_sanitized_path(request: Request) -> str:
    raw_path = request.url.path
    if request.url.query:
        raw_path = f"{raw_path}?{request.url.query}"
    return redact_url(raw_path)
