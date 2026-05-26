"""Scheduler for periodic update checking and notifications."""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

from services.discord_service import DiscordService
from services.update_service import get_update_service

logger = logging.getLogger(__name__)


class UpdateScheduler:
    """Manages periodic update checking and notifications."""

    def __init__(self, discord_service: DiscordService):
        self.discord_service = discord_service
        self.update_service = get_update_service()
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._last_notified_build: Optional[str] = None

    async def start(self):
        """Start the periodic update checker."""
        if self._running:
            logger.warning("Update scheduler already running")
            return

        self._running = True
        self._task = asyncio.create_task(self._run_scheduler())
        logger.info(
            f"Update scheduler started (checking every {self.update_service.check_interval} hours)"
        )

    async def stop(self):
        """Stop the update checker."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Update scheduler stopped")

    async def _run_scheduler(self):
        """Main scheduler loop."""
        # Wait a bit before first check (let system initialize)
        await asyncio.sleep(60)

        while self._running:
            try:
                await self._check_and_notify()
            except Exception as e:
                logger.error(f"Error in update scheduler: {e}", exc_info=True)

            # Sleep for configured interval
            interval_seconds = self.update_service.check_interval * 3600
            await asyncio.sleep(interval_seconds)

    async def _check_and_notify(self):
        """Check for updates and send notifications if needed."""
        logger.info("Running scheduled update check")

        try:
            result = await self.update_service.check_for_updates()

            if not result.get("success"):
                logger.warning(f"Update check failed: {result.get('error')}")
                return

            update_available = result.get("update_available", False)
            latest_build = result.get("latest_build")
            current_build = result.get("current_build")

            logger.info(
                f"Update check complete: current={current_build}, latest={latest_build}, "
                f"available={update_available}"
            )

            # Send notification if update is newly available
            if update_available and latest_build != self._last_notified_build:
                await self._send_update_notification(
                    current_build=current_build or "unknown",
                    latest_build=latest_build or "unknown",
                )
                self._last_notified_build = latest_build

        except Exception as e:
            logger.error(f"Error checking for updates: {e}", exc_info=True)

    async def _send_update_notification(self, current_build: str, latest_build: str):
        """Send Discord notification about available update."""
        try:
            message = (
                "🔔 **Server Update Available**\n\n"
                f"📦 **Current Build:** `{current_build}`\n"
                f"🆕 **Latest Build:** `{latest_build}`\n\n"
                f"To update your server:\n"
                f"1. SSH into the host: `ssh dunebrah@daspicebox`\n"
                f"2. Navigate to server dir: `cd ~/dune-server-docker`\n"
                f"3. Run update script: `./dune update`\n\n"
                f"⚠️ Updating will restart the server (brief downtime).\n"
                f"💾 Always create a backup before updating."
            )

            await self.discord_service.send_notification(
                message=message,
                notification_type="update_available",
            )

            logger.info(f"Sent update notification for build {latest_build}")

        except Exception as e:
            logger.error(f"Failed to send update notification: {e}", exc_info=True)


# Global singleton
_update_scheduler: Optional[UpdateScheduler] = None


def get_update_scheduler(discord_service: DiscordService) -> UpdateScheduler:
    """Get or create the global UpdateScheduler instance."""
    global _update_scheduler
    if _update_scheduler is None:
        _update_scheduler = UpdateScheduler(discord_service)
    return _update_scheduler
