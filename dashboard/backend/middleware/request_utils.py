from __future__ import annotations

import ipaddress
import os

from starlette.requests import Request

from middleware.redaction import redact_url

# Trusted proxy CIDRs — only honor X-Forwarded-For from these sources
_TRUSTED_PROXIES: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []


def _load_trusted_proxies() -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    """Parse TRUSTED_PROXY_CIDRS env (comma-separated). Defaults to
    Docker bridge + loopback when unset."""
    raw = os.getenv("TRUSTED_PROXY_CIDRS", "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16")
    nets: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for cidr in raw.split(","):
        cidr = cidr.strip()
        if cidr:
            nets.append(ipaddress.ip_network(cidr, strict=False))
    return nets


def _is_trusted_proxy(ip: str) -> bool:
    if not _TRUSTED_PROXIES:
        _TRUSTED_PROXIES.extend(_load_trusted_proxies())
    try:
        addr = ipaddress.ip_address(ip)
        return any(addr in net for net in _TRUSTED_PROXIES)
    except ValueError:
        return False


def get_client_ip(request: Request) -> str:
    direct_ip = request.client.host if request.client else ""

    # Only trust forwarding headers when the direct connection is from a known proxy
    if direct_ip and _is_trusted_proxy(direct_ip):
        forwarded_for = request.headers.get("X-Forwarded-For", "")
        if forwarded_for:
            return forwarded_for.split(",", 1)[0].strip() or "unknown"

        real_ip = request.headers.get("X-Real-IP", "").strip()
        if real_ip:
            return real_ip

    if direct_ip:
        return direct_ip

    return "unknown"


def get_sanitized_path(request: Request) -> str:
    raw_path = request.url.path
    if request.url.query:
        raw_path = f"{raw_path}?{request.url.query}"
    return redact_url(raw_path)
