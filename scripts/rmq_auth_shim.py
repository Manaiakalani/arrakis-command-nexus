#!/usr/bin/env python3
"""RabbitMQ HTTP auth-backend shim for Dune Awakening.

Sits in front of RabbitMQ's HTTP auth backend and allows:
  - Internal service users (director, text-router, gateway, etc.)
  - Player connections (hex Steam IDs)
  - An optional management user for admin tooling
All other requests are forwarded to the text-router for validation.
"""
import collections
import hmac
import logging
import os
import re
import time
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WORLD_UNIQUE_NAME = os.environ["WORLD_UNIQUE_NAME"]
UPSTREAM = os.environ.get("TEXT_ROUTER_AUTH_BASE", "http://text-router:8080")
MANAGEMENT_USER = os.environ.get("DUNE_RMQ_MANAGEMENT_USER", "")
MANAGEMENT_PASSWORD = os.environ.get("DUNE_RMQ_MANAGEMENT_PASSWORD", "")

SERVICE_USER_RE = re.compile(
    rf"^(sg|bgd|tr)\.{re.escape(WORLD_UNIQUE_NAME)}\.[^.]+(?:\.(game|admin))?$"
)
PLAYER_USER_RE = re.compile(r"^[0-9A-Fa-f]{16}$")

# Per-IP denial rate limiter: max denies before temporary block
_RATE_LIMIT_WINDOW = 60  # seconds
_RATE_LIMIT_MAX_DENIES = 20
_deny_counts: dict[str, collections.deque] = {}
_deny_lock = threading.Lock()

logger = logging.getLogger("rmq-auth-shim")


def _is_rate_limited(ip: str) -> bool:
    """Return True if this IP has exceeded the denial rate limit."""
    now = time.monotonic()
    with _deny_lock:
        dq = _deny_counts.get(ip)
        if dq is None:
            return False
        while dq and dq[0] < now - _RATE_LIMIT_WINDOW:
            dq.popleft()
        return len(dq) >= _RATE_LIMIT_MAX_DENIES


def _record_deny(ip: str) -> None:
    """Record a deny event for rate limiting."""
    now = time.monotonic()
    with _deny_lock:
        if ip not in _deny_counts:
            _deny_counts[ip] = collections.deque()
        _deny_counts[ip].append(now)


def parse_form(body: bytes) -> dict:
    parsed = urllib.parse.parse_qs(
        body.decode("utf-8", errors="replace"), keep_blank_values=True
    )
    return {k: v[-1] if v else "" for k, v in parsed.items()}


def post_upstream(path: str, body: bytes, content_type: str) -> bytes:
    req = urllib.request.Request(f"{UPSTREAM}{path}", data=body, method="POST")
    req.add_header("Content-Type", content_type or "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.read()


class Handler(BaseHTTPRequestHandler):
    server_version = "dune-rmq-auth-shim"

    def do_POST(self) -> None:
        client_ip = self.client_address[0]
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        form = parse_form(body)
        username = form.get("username", "")

        if self.path in {
            "/v0/auth/user",
            "/v0/auth/vhost",
            "/v0/auth/resource",
            "/v0/auth/topic",
        }:
            # Management user — password only sent on /auth/user per RabbitMQ HTTP auth protocol
            if MANAGEMENT_USER and hmac.compare_digest(username, MANAGEMENT_USER):
                if self.path == "/v0/auth/user":
                    # Rate-limit management login attempts (keyed by username, not broker IP)
                    if _is_rate_limited(MANAGEMENT_USER):
                        logger.warning("Management login rate-limited")
                        self._respond(b"deny")
                        return
                    if hmac.compare_digest(form.get("password", ""), MANAGEMENT_PASSWORD):
                        self._respond(b"allow administrator")
                        return
                    logger.warning("Management user denied — bad password from %s", client_ip)
                    _record_deny(MANAGEMENT_USER)
                    self._respond(b"deny")
                    return
                # vhost/resource/topic — no password in request; allow by username
                self._respond(b"allow")
                return

            if SERVICE_USER_RE.match(username) or PLAYER_USER_RE.match(username):
                # Service users (sg.*, gw.*, dr.*, tr.*) need the `administrator`
                # tag so they can PUT /api/users/<player_id> + grant permissions
                # when provisioning AMQP credentials for new players. Without it,
                # RabbitMQ returns 401 "Not administrator user" on the HTTP API,
                # the game server can't create the player's chat user, and the
                # client sees Error: P83 on map entry. (The `management` tag is
                # not enough - granting permissions to a user requires the
                # higher-privilege `administrator` tag in RabbitMQ's auth model.)
                # Player users themselves just need plain `allow` (no tags).
                if SERVICE_USER_RE.match(username) and self.path == "/v0/auth/user":
                    self._respond(b"allow administrator")
                else:
                    self._respond(b"allow")
                return

        # Unknown user — forward to text-router
        try:
            self._respond(post_upstream(self.path, body, self.headers.get("Content-Type")))
        except Exception:
            logger.warning("Upstream auth failed for %s from %s", username, client_ip)
            self._respond(b"deny")

    def log_message(self, fmt: str, *args) -> None:
        pass

    def _respond(self, body: bytes) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class AuthServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = int(os.environ.get("RMQ_AUTH_SHIM_BACKLOG", "128"))


if __name__ == "__main__":
    logging.basicConfig(level=os.environ.get("RMQ_AUTH_SHIM_LOG_LEVEL", "INFO").upper(), format="[%(levelname)s] %(message)s")
    logger.info("RMQ auth shim listening on :8080")
    AuthServer(("0.0.0.0", 8080), Handler).serve_forever()
