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
        self.routing_key = ""
        self.history: list[dict] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def send_announcement(self, message: str, sender: str | None = None) -> bool:
        """Send an in-game chat announcement via RabbitMQ TextChat protocol."""
        if not self.enabled:
            self._remember(message, sender or self.sender_name, "skipped", "Announcements disabled")
            return False

        connection: pika.BlockingConnection | None = None
        try:
            # 1. Discover online player queues via management API
            player_queues = self._get_online_player_queues()
            if not player_queues:
                logger.info("No online player queues found, announcement saved but no recipients")
                self._remember(message, sender or self.sender_name, "sent", "No players online")
                return True

            # 2. Bind each player queue to chat.map with our routing key
            self._bind_player_queues(player_queues)

            # 3. Build the TextChat payload
            body = self._build_textchat_payload(message, sender)

            # 4. Connect and publish
            connection = pika.BlockingConnection(self._connection_parameters())
            channel = connection.channel()
            channel.basic_publish(
                exchange=self.exchange,
                routing_key=self.routing_key,
                body=body,
                properties=pika.BasicProperties(
                    content_type="Content",
                    delivery_mode=1,
                    timestamp=int(time.time()),
                    type="text_chat",
                    message_id=secrets.token_urlsafe(16),
                ),
                mandatory=False,
            )
            logger.info("Announcement sent to %d player queue(s)", len(player_queues))
            self._remember(message, sender or self.sender_name, "sent",
                           f"Delivered to {len(player_queues)} player(s)")
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
        """Bind player queues to chat.map exchange so messages get routed."""
        vhost = urllib.parse.quote(self.virtual_host, safe="")
        exchange = urllib.parse.quote(self.exchange, safe="")
        auth = self._mgmt_auth_header()
        binding_data = json.dumps({"routing_key": self.routing_key, "arguments": {}}).encode()

        for queue_name in queue_names:
            try:
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
                logger.debug("Failed to bind queue %s: %s", queue_name, exc)

    # ------------------------------------------------------------------
    # AMQP connection
    # ------------------------------------------------------------------

    def _connection_parameters(self) -> pika.ConnectionParameters:
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
