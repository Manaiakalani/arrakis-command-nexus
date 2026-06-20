#!/usr/bin/env python3
"""RabbitMQ HTTP auth-backend shim for Dune Awakening.

Sits in front of RabbitMQ's HTTP auth backend and allows:
  - Internal service users (director, text-router, gateway, etc.)
  - Player connections (hex Steam IDs)
  - An optional management user for admin tooling
All other requests are forwarded to the text-router for validation.
"""
import hmac
import logging
import os
import re
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

logger = logging.getLogger("rmq-auth-shim")


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
            if MANAGEMENT_USER and hmac.compare_digest(username, MANAGEMENT_USER):
                if (
                    self.path == "/v0/auth/user"
                    and hmac.compare_digest(form.get("password", ""), MANAGEMENT_PASSWORD)
                ):
                    self._respond(b"allow administrator")
                    return
                if self.path != "/v0/auth/user":
                    self._respond(b"allow")
                    return
                self._respond(b"deny")
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

        try:
            self._respond(post_upstream(self.path, body, self.headers.get("Content-Type")))
        except Exception:
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
