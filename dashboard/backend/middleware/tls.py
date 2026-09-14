"""TLS request detection shared by security headers.

Kept free of Starlette/FastAPI so unit tests can import it on a bare
interpreter.
"""

from __future__ import annotations

HSTS_VALUE = "max-age=31536000; includeSubDomains"


def is_https_request(scheme: str, forwarded_proto: str | None = None) -> bool:
    """Whether this request was delivered over TLS.

    Prefer ``X-Forwarded-Proto`` so a TLS terminator in front of HTTP
    still gets HSTS. A bare HTTP request must not advertise HSTS.
    """
    if forwarded_proto:
        return forwarded_proto.split(",")[0].strip().lower() == "https"
    return scheme.lower() == "https"
