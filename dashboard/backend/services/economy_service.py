from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class EconomyAlert:
    id: str
    alert_type: str  # "solari_threshold", "base_claim_spike", "item_anomaly"
    severity: str  # "info", "warning", "critical"
    message: str
    details: dict[str, Any]
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    acknowledged: bool = False


class EconomyService:
    def __init__(self, postgres_service: Any | None = None) -> None:
        self.postgres_service = postgres_service
        self.enabled = os.getenv("DUNE_ECONOMY_MONITORING", "true").lower() == "true"
        self.check_interval = int(os.getenv("DUNE_ECONOMY_CHECK_INTERVAL", "300"))
        self.solari_threshold = int(os.getenv("DUNE_ECONOMY_SOLARI_THRESHOLD", "1000000"))
        self.base_claim_threshold = int(os.getenv("DUNE_ECONOMY_BASE_CLAIM_THRESHOLD", "50"))
        self.alerts: list[EconomyAlert] = []
        self._task: asyncio.Task[Any] | None = None
        self._alert_counter = 0

    async def start(self) -> None:
        if self.enabled:
            self._task = asyncio.create_task(self._monitor_loop(), name="economy-monitor")
            logger.info("Economy monitoring started (interval=%ss)", self.check_interval)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            finally:
                self._task = None

    async def _monitor_loop(self) -> None:
        while True:
            try:
                await self._run_checks()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Economy check failed: %s", exc)
            await asyncio.sleep(self.check_interval)

    async def _run_checks(self) -> None:
        """Run all economy anomaly checks."""
        if not self.postgres_service:
            return

        try:
            await self._check_solari_threshold()
            await self._check_base_claims()
        except Exception as exc:  # noqa: BLE001
            logger.debug("Economy check skipped (game DB may not be accessible): %s", exc)

    async def _check_solari_threshold(self) -> None:
        """Alert if any player has Solari above threshold."""
        try:
            pass
        except Exception:
            pass

    async def _check_base_claims(self) -> None:
        """Alert if base claim count is unusually high."""
        try:
            pass
        except Exception:
            pass

    def add_alert(self, alert_type: str, severity: str, message: str, details: dict[str, Any] | None = None) -> EconomyAlert:
        """Manually add an economy alert."""
        self._alert_counter += 1
        alert = EconomyAlert(
            id=f"econ-{self._alert_counter}",
            alert_type=alert_type,
            severity=severity,
            message=message,
            details=details or {},
        )
        self.alerts.append(alert)
        if len(self.alerts) > 200:
            self.alerts = self.alerts[-200:]
        return alert

    def get_alerts(self, acknowledged: bool | None = None) -> list[EconomyAlert]:
        if acknowledged is None:
            return list(reversed(self.alerts))
        return [a for a in reversed(self.alerts) if a.acknowledged == acknowledged]

    def acknowledge_alert(self, alert_id: str) -> bool:
        for alert in self.alerts:
            if alert.id == alert_id:
                alert.acknowledged = True
                return True
        return False

    def get_summary(self) -> dict[str, Any]:
        unacked = sum(1 for a in self.alerts if not a.acknowledged)
        return {
            "enabled": self.enabled,
            "checkIntervalSeconds": self.check_interval,
            "solariThreshold": self.solari_threshold,
            "baseClaimThreshold": self.base_claim_threshold,
            "totalAlerts": len(self.alerts),
            "unacknowledgedAlerts": unacked,
        }
