"""Scheduler for periodic update checking and notifications."""

import asyncio
import logging
import os
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
        self.update_service._discord_service = discord_service
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
        """Check for updates and send notifications (or auto-apply) if needed."""
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

            if not update_available:
                return

            # Auto-update path
            if self.update_service.auto_update_enabled:
                logger.info("Auto-update enabled — triggering update for build %s", latest_build)
                await self._send_pre_update_notification(current_build or "unknown", latest_build or "unknown")
                update_result = await self.update_service.trigger_update()
                if update_result.get("success"):
                    await self._send_update_complete_notification(
                        new_tag=update_result.get("new_tag", "unknown"),
                        restarted=update_result.get("restarted", []),
                    )
                    self._last_notified_build = latest_build
                else:
                    err = update_result.get("error", "Unknown error")
                    logger.error("Auto-update failed: %s", err)
                    await self._send_update_failed_notification(latest_build or "unknown", err)
                return

            # Notification-only path (no auto-update)
            if latest_build != self._last_notified_build:
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
            ssh_user = os.environ.get("DUNE_SSH_USER", "<your-user>")
            ssh_host = os.environ.get("DUNE_SSH_HOST", "<your-host>")
            ssh_target = f"{ssh_user}@{ssh_host}"
            message = (
                "🔔 **Server Update Available**\n\n"
                f"📦 **Current Build:** `{current_build}`\n"
                f"🆕 **Latest Build:** `{latest_build}`\n\n"
                f"To update your server:\n"
                f"1. SSH into the host: `ssh {ssh_target}`\n"
                f"2. Navigate to server dir: `cd ~/dune-server-docker`\n"
                f"3. Run update script: `./dune update`\n\n"
                f"⚠️ Updating will restart the server (brief downtime).\n"
                f"💾 Always create a backup before updating."
            )

            await self.discord_service.enqueue(
                event_type="update_available",
                message=message,
                title="🔄 Server Update Available",
            )

            logger.info(f"Sent update notification for build {latest_build}")

        except Exception as e:
            logger.error(f"Failed to send update notification: {e}", exc_info=True)

    async def _send_pre_update_notification(self, current_build: str, latest_build: str):
        """Notify Discord that auto-update is about to start."""
        try:
            await self.discord_service.enqueue(
                event_type="update_available",
                message=(
                    f"⚙️ **Auto-Update Starting**\n\n"
                    f"📦 Current: `{current_build}`  →  🆕 Latest: `{latest_build}`\n\n"
                    f"The server will restart momentarily. Please find a safe location."
                ),
                title="🔄 Auto-Update Starting",
            )
        except Exception as e:
            logger.error("Failed to send pre-update notification: %s", e)

    async def _send_update_complete_notification(self, new_tag: str, restarted: list):
        """Notify Discord that auto-update completed successfully."""
        try:
            containers = ", ".join(restarted) if restarted else "none"
            await self.discord_service.enqueue(
                event_type="update_available",
                message=(
                    f"✅ **Auto-Update Complete**\n\n"
                    f"🏷️ New image tag: `{new_tag}`\n"
                    f"🔁 Restarted containers: {containers}\n\n"
                    f"The server is back online."
                ),
                title="✅ Auto-Update Complete",
            )
        except Exception as e:
            logger.error("Failed to send update-complete notification: %s", e)

    async def _send_update_failed_notification(self, latest_build: str, error: str):
        """Notify Discord that auto-update failed."""
        try:
            await self.discord_service.enqueue(
                event_type="update_available",
                message=(
                    f"❌ **Auto-Update Failed**\n\n"
                    f"🆕 Target build: `{latest_build}`\n"
                    f"⚠️ Error: {error[:300]}\n\n"
                    f"Manual update required: `./dune update`"
                ),
                title="❌ Auto-Update Failed",
            )
        except Exception as e:
            logger.error("Failed to send update-failed notification: %s", e)


# Global singleton
_update_scheduler: Optional[UpdateScheduler] = None


def get_update_scheduler(discord_service: DiscordService) -> UpdateScheduler:
    """Get or create the global UpdateScheduler instance."""
    global _update_scheduler
    if _update_scheduler is None:
        _update_scheduler = UpdateScheduler(discord_service)
    return _update_scheduler
