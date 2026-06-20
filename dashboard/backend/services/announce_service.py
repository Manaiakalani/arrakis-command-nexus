from __future__ import annotations

import base64
import json
import logging
import os
import re
import secrets
import ssl
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pika

logger = logging.getLogger(__name__)

_PLAYER_QUEUE_PATTERN = re.compile(r"^[0-9A-Fa-f]{16}_queue$")


class AnnounceService:
    def __init__(self) -> None:
        self.host = os.getenv("DUNE_RMQ_HOST", "game-rmq")
        self.port = int(os.getenv("DUNE_RMQ_PORT", "5672"))
        self.username = (
            os.getenv("DUNE_RMQ_USERNAME")
            or os.getenv("DUNE_RMQ_USER")
            or os.getenv("DUNE_RMQ_MANAGEMENT_USER")
            or os.getenv("RABBITMQ_DEFAULT_USER")
        )
        self.password = (
            os.getenv("DUNE_RMQ_PASSWORD")
            or os.getenv("DUNE_RMQ_PASS")
            or os.getenv("DUNE_RMQ_MANAGEMENT_PASSWORD")
            or os.getenv("RABBITMQ_DEFAULT_PASS")
        )
        self.virtual_host = os.getenv("DUNE_RMQ_VHOST", "/")
        self.sender_name = os.getenv("DUNE_ANNOUNCE_NAME", "Server")
        self.funcom_id = os.getenv("DUNE_ANNOUNCE_FUNCOM_ID", "ADMIN#00001")
        self.enabled = os.getenv("DUNE_ANNOUNCE_ENABLED", "true").lower() == "true"
        self.tls_enabled = os.getenv("DUNE_RMQ_TLS_ENABLED", "true").lower() == "true"
        self.ca_cert_path = os.getenv("DUNE_RMQ_CA_CERT", "/workspace/config/tls/rabbitmq/ca.crt")
        self.mgmt_port = int(os.getenv("DUNE_RMQ_MGMT_PORT", "15672"))
        self.exchange = "chat.map"
        # Routing keys for chat.map: empty string covers default binding,
        # map-specific keys reach map-bound queues
        self.routing_keys = [
            rk.strip() for rk in
            os.getenv("DUNE_ANNOUNCE_ROUTING_KEYS", ",Survival_1.dim_0,HaggaBasin.0").split(",")
        ]
        self.routing_key = ""
        # Dedicated announcer AMQP credentials: must be a valid 16-hex-char
        # "player" account so the auth-shim accepts it and user_id matches
        self.chat_user = os.getenv("DUNE_ANNOUNCE_CHAT_USER", "A000000000000001")
        self.chat_password = os.getenv("DUNE_ANNOUNCE_CHAT_PASSWORD", "announce")
        self.history: list[dict] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def send_announcement(self, message: str, sender: str | None = None) -> bool:
        """Send an in-game chat announcement via RabbitMQ directly to chat.map.

        Publishes to the chat.map direct exchange with multiple routing keys
        so the message reaches all connected players. Player queues are
        pre-bound via the RMQ management API before publishing.

        Note: chat.intercept is NOT used because the TextRouter has a user_id
        mismatch bug that causes PRECONDITION_FAILED on republish.
        """
        if not self.enabled:
            self._remember(message, sender or self.sender_name, "skipped", "Announcements disabled")
            return False

        connection: pika.BlockingConnection | None = None
        try:
            # Pre-bind online player queues to chat.map with each routing key
            player_queues = self._get_online_player_queues()
            if player_queues:
                self._bind_player_queues(player_queues)
                logger.info("Bound %d player queue(s) to %s", len(player_queues), self.exchange)
            else:
                logger.warning("No online player queues found; message may not be delivered")

            body = self._build_textchat_payload(message, sender)
            connection = pika.BlockingConnection(self._chat_connection_parameters())
            channel = connection.channel()

            # Publish once to chat.map with empty routing key.
            # Player queues are pre-bound to all routing keys above, so a
            # single publish with "" matches the default binding and avoids
            # duplicate delivery.
            channel.basic_publish(
                exchange="chat.map",
                routing_key="",
                body=body,
                properties=pika.BasicProperties(
                    content_type="Content",
                    delivery_mode=1,
                    timestamp=int(time.time()),
                    type="text_chat",
                    user_id=self.chat_user,
                    message_id=secrets.token_urlsafe(16),
                ),
                mandatory=False,
            )
            logger.info(
                "Announcement published to chat.map (%d player(s) bound)",
                len(player_queues),
            )
            self._remember(message, sender or self.sender_name, "sent",
                           f"Published to chat.map ({len(player_queues)} player(s))")
            return True
        except Exception as exc:
            logger.warning("Failed to send announcement: %s", exc, exc_info=True)
            self._remember(message, sender or self.sender_name, "failed", str(exc))
            return False
        finally:
            if connection is not None and connection.is_open:
                connection.close()

    def send_pre_restart_warning(self, minutes: int = 5) -> bool:
        """Send a pre-restart warning message."""
        return self.send_announcement(
            f"Server will restart in {minutes} minute{'s' if minutes != 1 else ''}. Please find a safe location."
        )

    # ------------------------------------------------------------------
    # TextChat payload construction
    # ------------------------------------------------------------------

    def _build_textchat_payload(self, message: str, sender: str | None = None) -> bytes:
        """Build the double-nested TextChat JSON payload the game client expects."""
        display_name = sender or self.sender_name
        inner = {
            "m_Id": uuid.uuid4().hex.upper(),
            "m_ChannelType": "Map",
            "m_bUseSpoofedUserName": True,
            "m_SpoofedUserNameFrom": {
                "m_TableId": "",
                "m_Key": "",
                "m_UnlocalizedName": display_name,
            },
            "m_FuncomIdFrom": self.funcom_id,
            "m_UserNameTo": "",
            "m_Message": {
                "m_UnlocalizedMessage": message,
                "m_LocalizedMessage": {
                    "m_TableId": "",
                    "m_Key": "",
                    "m_FormatArgs": [],
                },
            },
            "m_TimeStamp": time.strftime("%Y.%m.%d-%H.%M.%S", time.gmtime()),
            "m_OriginLocation": {"X": 0.0, "Y": 0.0, "Z": 0.0},
            "m_HasSeenMessage": False,
        }
        outer = {
            "content": json.dumps(inner, separators=(",", ":")),
            "Type": "TextChat",
        }
        return json.dumps(outer, separators=(",", ":")).encode("utf-8")

    # ------------------------------------------------------------------
    # Player queue discovery and binding via RMQ Management API
    # ------------------------------------------------------------------

    def _mgmt_auth_header(self) -> str:
        creds = f"{self.username}:{self.password or ''}"
        return f"Basic {base64.b64encode(creds.encode()).decode()}"

    def _get_online_player_queues(self) -> list[str]:
        """Query RMQ management API for live player queues."""
        try:
            vhost = urllib.parse.quote(self.virtual_host, safe="")
            url = f"http://{self.host}:{self.mgmt_port}/api/queues/{vhost}"
            req = urllib.request.Request(url, headers={"Authorization": self._mgmt_auth_header()})
            with urllib.request.urlopen(req, timeout=10) as resp:
                queues = json.loads(resp.read())
            return [
                q["name"]
                for q in queues
                if _PLAYER_QUEUE_PATTERN.match(q.get("name", ""))
                and q.get("consumers", 0) > 0
            ]
        except Exception as exc:
            logger.warning("Failed to query player queues from management API: %s", exc)
            return []

    def _bind_player_queues(self, queue_names: list[str]) -> None:
        """Bind player queues to chat.map exchange with all routing keys."""
        vhost = urllib.parse.quote(self.virtual_host, safe="")
        exchange = urllib.parse.quote(self.exchange, safe="")
        auth = self._mgmt_auth_header()

        for queue_name in queue_names:
            for rk in self.routing_keys:
                try:
                    binding_data = json.dumps({"routing_key": rk, "arguments": {}}).encode()
                    queue_enc = urllib.parse.quote(queue_name, safe="")
                    url = f"http://{self.host}:{self.mgmt_port}/api/bindings/{vhost}/e/{exchange}/q/{queue_enc}"
                    req = urllib.request.Request(
                        url,
                        data=binding_data,
                        headers={"Authorization": auth, "Content-Type": "application/json"},
                        method="POST",
                    )
                    urllib.request.urlopen(req, timeout=5).close()
                except Exception as exc:
                    logger.debug("Failed to bind queue %s with key '%s': %s", queue_name, rk, exc)

    # ------------------------------------------------------------------
    # AMQP connection
    # ------------------------------------------------------------------

    def _connection_parameters(self) -> pika.ConnectionParameters:
        """Management connection (used for queue binding via mgmt API fallback)."""
        credentials = None
        if self.username:
            credentials = pika.PlainCredentials(self.username, self.password or "")

        kwargs = {
            "host": self.host,
            "port": self.port,
            "virtual_host": self.virtual_host,
            "heartbeat": 30,
            "blocked_connection_timeout": 10,
            "credentials": credentials,
        }
        if self.tls_enabled:
            kwargs["ssl_options"] = pika.SSLOptions(self._ssl_context(), self.host)
        if credentials is None:
            kwargs.pop("credentials")
        return pika.ConnectionParameters(**kwargs)

    def _chat_connection_parameters(self) -> pika.ConnectionParameters:
        """Announcer connection: authenticates as the chat user (A000000000000001)
        so that user_id in published messages matches the authenticated user."""
        credentials = pika.PlainCredentials(self.chat_user, self.chat_password)
        kwargs = {
            "host": self.host,
            "port": self.port,
            "virtual_host": self.virtual_host,
            "heartbeat": 0,
            "blocked_connection_timeout": 10,
            "credentials": credentials,
        }
        if self.tls_enabled:
            kwargs["ssl_options"] = pika.SSLOptions(self._ssl_context(), self.host)
        return pika.ConnectionParameters(**kwargs)

    def _ssl_context(self) -> ssl.SSLContext:
        cert_path = Path(self.ca_cert_path)
        if cert_path.exists():
            context = ssl.create_default_context(cafile=str(cert_path))
        else:
            context = ssl.create_default_context()
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        context.check_hostname = False
        return context

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------

    def _remember(self, message: str, sender: str, status: str, error: str | None = None) -> None:
        entry = {
            "message": message,
            "sender": sender,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": status,
        }
        if error:
            entry["error"] = error
        self.history.append(entry)
        if len(self.history) > 50:
            self.history = self.history[-50:]
