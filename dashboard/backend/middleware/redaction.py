from __future__ import annotations

import os
import re
from collections.abc import Callable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_REPLACERS: list[tuple[re.Pattern[str], str | Callable[[re.Match[str]], str]]]
_REPLACERS = [
    (re.compile(r"(?i)(\bfls[_-]?token\b\s*[:=]\s*)([^\s,;]+)"), r"\1[REDACTED]"),
    (re.compile(r"(?i)(\bx-admin-token\b\s*[:=]\s*)([^\s,;]+)"), r"\1[REDACTED]"),
    (re.compile(r"(?i)(\bauthorization\b\s*:\s*bearer\s+)([^\s,;]+)"), r"\1[REDACTED]"),
    (re.compile(r"(?i)([?&](?:access[_-]?token|admin[_-]?token|api[_-]?key|authorization|password|secret|token)=)([^&\s]+)"), r"\1[REDACTED]"),
    (re.compile(r"(?i)([\"']authorization[\"']\s*[:=]\s*[\"'])([^\"']+)"), r"\1[REDACTED]"),
    (re.compile(r"(?i)([\"']x-admin-token[\"']\s*[:=]\s*[\"'])([^\"']+)"), r"\1[REDACTED]"),
    (re.compile(r"(?i)(\brabbit(?:mq)?[_-]?(?:password|secret|token)\b\s*[:=]\s*)([^\s,;]+)"), r"\1[REDACTED]"),
    (re.compile(r"(?i)(\b(?:postgres|pg|database|db)[_-]?password\b\s*[:=]\s*)([^\s,;]+)"), r"\1[REDACTED]"),
    (re.compile(r"(?i)(\bsteam[_-]?(?:token|api[_-]?key|secret)\b\s*[:=]\s*)([^\s,;]+)"), r"\1[REDACTED]"),
    (re.compile(r"(?i)(https://discord(?:app)?\.com/api/webhooks/\d+/)([^\s/]+)"), r"\1[REDACTED]"),
    (re.compile(r"(?i)(amqps?://[^:\s]+:)([^@\s]+)(@)"), r"\1[REDACTED]\3"),
    (re.compile(r"(?i)(postgres(?:ql)?://[^:\s]+:)([^@\s/]+)(@)"), r"\1[REDACTED]\3"),
    (re.compile(r"(?i)(\b(?:password|secret|token)\b\s*[:=]\s*)([^\s,;]+)"), r"\1[REDACTED]"),
]
_SENSITIVE_QUERY_PARAMS = {
    "access_token",
    "admin_token",
    "api_key",
    "apikey",
    "authorization",
    "password",
    "secret",
    "token",
    "webhook_url",
    "x-admin-token",
}
_IP_PATTERN = re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b")


def redact_url(url: str) -> str:
    if not url:
        return url

    try:
        parts = urlsplit(url)
        if not parts.query:
            return url
        redacted_items: list[tuple[str, str]] = []
        for key, value in parse_qsl(parts.query, keep_blank_values=True):
            normalized = key.lower()
            if normalized in _SENSITIVE_QUERY_PARAMS or any(
                marker in normalized for marker in ("token", "secret", "password", "authorization")
            ):
                redacted_items.append((key, "[REDACTED]"))
            else:
                redacted_items.append((key, value))
        return urlunsplit(parts._replace(query=urlencode(redacted_items, doseq=True)))
    except ValueError:
        return url


def redact(text: str) -> str:
    if not text:
        return text

    value = redact_url(text)
    for pattern, replacement in _REPLACERS:
        value = pattern.sub(replacement, value)

    if os.getenv("DUNE_REDACT_IP_ADDRESSES", "false").lower() in {"1", "true", "yes", "on"}:
        value = _IP_PATTERN.sub("[REDACTED]", value)

    return value
