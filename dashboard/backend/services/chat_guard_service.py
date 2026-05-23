from __future__ import annotations

import asyncio
import logging
import os
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


@dataclass
class SpamViolation:
    steam_id: str
    player_name: str
    violation_type: str  # "consecutive_duplicate", "rate_limit", "pattern_match"
    message: str
    action_taken: str  # "warned", "muted", "kicked"
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class ChatGuardService:
    def __init__(self, docker_service=None):
        self.docker_service = docker_service
        self.enabled = os.getenv("DUNE_CHAT_GUARD_ENABLED", "true").lower() == "true"
        self.max_consecutive = int(os.getenv("DUNE_CHAT_MAX_CONSECUTIVE", "3"))
        self.rate_window_seconds = int(os.getenv("DUNE_CHAT_RATE_WINDOW", "10"))
        self.rate_max_messages = int(os.getenv("DUNE_CHAT_RATE_MAX", "5"))
        self.auto_kick = os.getenv("DUNE_CHAT_AUTO_KICK", "false").lower() == "true"

        self._message_history: dict[str, list[dict]] = defaultdict(list)
        self.violations: list[SpamViolation] = []
        self._task: asyncio.Task | None = None

    async def start(self):
        if self.enabled:
            logger.info(
                "Chat guard started (consecutive=%d, rate=%d/%ds, auto_kick=%s)",
                self.max_consecutive,
                self.rate_max_messages,
                self.rate_window_seconds,
                self.auto_kick,
            )

    async def stop(self):
        if self._task:
            self._task.cancel()

    def process_message(self, steam_id: str, player_name: str, message: str) -> SpamViolation | None:
        """Process an incoming chat message and check for spam."""
        if not self.enabled:
            return None

        now = datetime.now(timezone.utc)
        history = self._message_history[steam_id]

        history.append({"message": message, "timestamp": now})

        cutoff = now.timestamp() - self.rate_window_seconds
        self._message_history[steam_id] = [m for m in history if m["timestamp"].timestamp() > cutoff]
        history = self._message_history[steam_id]

        if len(history) >= self.max_consecutive:
            recent = [m["message"] for m in history[-self.max_consecutive:]]
            if len(set(recent)) == 1:
                return self._create_violation(
                    steam_id,
                    player_name,
                    "consecutive_duplicate",
                    f"Sent '{message}' {self.max_consecutive}x consecutively",
                )

        if len(history) > self.rate_max_messages:
            return self._create_violation(
                steam_id,
                player_name,
                "rate_limit",
                f"Sent {len(history)} messages in {self.rate_window_seconds}s (limit: {self.rate_max_messages})",
            )

        return None

    def _create_violation(self, steam_id: str, player_name: str, violation_type: str, message: str) -> SpamViolation:
        action = "kicked" if self.auto_kick else "warned"
        violation = SpamViolation(
            steam_id=steam_id,
            player_name=player_name,
            violation_type=violation_type,
            message=message,
            action_taken=action,
        )
        self.violations.append(violation)
        if len(self.violations) > 200:
            self.violations = self.violations[-200:]

        logger.warning("Chat spam detected: %s (%s) - %s [%s]", player_name, steam_id, message, action)

        if self.auto_kick and self.docker_service and hasattr(self.docker_service, "kick_player"):
            asyncio.create_task(self.docker_service.kick_player(steam_id))

        return violation

    def get_violations(self) -> list[dict]:
        return [
            {
                "steamId": v.steam_id,
                "playerName": v.player_name,
                "type": v.violation_type,
                "message": v.message,
                "action": v.action_taken,
                "timestamp": v.timestamp.isoformat(),
            }
            for v in reversed(self.violations)
        ]

    def get_settings(self) -> dict:
        return {
            "enabled": self.enabled,
            "maxConsecutive": self.max_consecutive,
            "rateWindowSeconds": self.rate_window_seconds,
            "rateMaxMessages": self.rate_max_messages,
            "autoKick": self.auto_kick,
            "totalViolations": len(self.violations),
        }
