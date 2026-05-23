from __future__ import annotations

import json
import logging
import os
import ssl
from datetime import datetime, timezone
from pathlib import Path

import pika

logger = logging.getLogger(__name__)


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
        self.enabled = os.getenv("DUNE_ANNOUNCE_ENABLED", "true").lower() == "true"
        self.exchange = os.getenv("DUNE_ANNOUNCE_EXCHANGE", "game.announcements")
        self.routing_key = os.getenv("DUNE_ANNOUNCE_ROUTING_KEY", "")
        self.tls_enabled = os.getenv("DUNE_RMQ_TLS_ENABLED", "true").lower() == "true"
        self.ca_cert_path = os.getenv("DUNE_RMQ_CA_CERT", "/workspace/config/tls/rabbitmq/ca.crt")
        self.history: list[dict] = []

    def send_announcement(self, message: str, sender: str | None = None) -> bool:
        """Send an in-game chat announcement via RabbitMQ."""
        if not self.enabled:
            self._remember(message, sender or self.sender_name, "skipped", "Announcements disabled")
            return False

        connection: pika.BlockingConnection | None = None
        try:
            connection = pika.BlockingConnection(self._connection_parameters())
            channel = connection.channel()
            payload = json.dumps(
                {
                    "type": "chat_announcement",
                    "sender": sender or self.sender_name,
                    "message": message,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )
            channel.basic_publish(
                exchange=self.exchange,
                routing_key=self.routing_key,
                body=payload,
            )
            self._remember(message, sender or self.sender_name, "sent")
            if connection.is_open:
                connection.close()
            return True
        except Exception as exc:
            logger.warning("Failed to send announcement: %s", exc)
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
