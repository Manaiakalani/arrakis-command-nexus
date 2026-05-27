"""Service for checking and managing Dune Awakening server updates."""

import asyncio
import json
import logging
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


class UpdateService:
    """Manages server update checking and execution."""

    def __init__(self):
        self.steam_app_id = os.getenv("STEAM_APP_ID", "3104830")
        self.current_tag = os.getenv("DUNE_IMAGE_TAG", "unknown")
        self.steam_dir = os.getenv("DUNE_STEAM_SERVER_DIR", "")
        self.check_interval = int(os.getenv("UPDATE_CHECK_INTERVAL_HOURS", "6"))
        self.auto_update_enabled = os.getenv("UPDATE_AUTO_UPDATE", "false").lower() == "true"
        
        # Persistence file for update history
        self.state_file = Path("/workspace/data/update_check_state.json")
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        
        self._last_check: Optional[datetime] = None
        self._latest_steam_build: Optional[str] = None
        self._baseline_steam_build: Optional[str] = None  # what we consider "installed"
        self._update_available = False

        # Load persisted state
        self._load_state()

    def _load_state(self):
        """Load last check state from disk."""
        if self.state_file.exists():
            try:
                data = json.loads(self.state_file.read_text())
                if data.get("last_check"):
                    self._last_check = datetime.fromisoformat(data["last_check"])
                self._latest_steam_build = data.get("latest_steam_build") or data.get("last_available_build")
                self._baseline_steam_build = data.get("baseline_steam_build") or data.get("last_installed_build")
                self._update_available = data.get("update_available", False)
            except Exception as e:
                logger.warning(f"Failed to load update state: {e}")

    def _persist_state(self):
        """Persist check state to disk."""
        try:
            data = {
                "last_check": self._last_check.isoformat() if self._last_check else None,
                "latest_steam_build": self._latest_steam_build,
                "baseline_steam_build": self._baseline_steam_build,
                "update_available": self._update_available,
            }
            self.state_file.write_text(json.dumps(data, indent=2))
        except Exception as e:
            logger.error(f"Failed to persist update state: {e}")

    async def check_for_updates(self) -> dict[str, Any]:
        """
        Check Steam for available updates without downloading.
        Compares Steam's latest build ID against our saved baseline (the build ID
        that was current when we last marked the server as up-to-date).
        """
        logger.info(f"Checking for updates to Steam App {self.steam_app_id}")

        try:
            # Get latest build ID from Steam (numeric depot build ID, e.g. "23243500")
            latest_build = await self._get_latest_build_id()
            if not latest_build:
                await self._log_audit("update_check_failed", {
                    "error": "Failed to retrieve build information from Steam"
                })
                return {
                    "success": False,
                    "error": "Failed to retrieve build information from Steam",
                    "last_check": self._last_check.isoformat() if self._last_check else None,
                }

            self._last_check = datetime.now()
            self._latest_steam_build = latest_build

            # Bootstrap baseline on first successful check so we don't false-alarm
            if not self._baseline_steam_build:
                logger.info(
                    f"No baseline build recorded – treating current Steam build "
                    f"{latest_build} as installed baseline"
                )
                self._baseline_steam_build = latest_build

            # An update is available only when Steam has a newer build than our baseline
            self._update_available = (latest_build != self._baseline_steam_build)

            self._persist_state()

            await self._log_audit("update_check_completed", {
                "baseline_build": self._baseline_steam_build,
                "latest_build": latest_build,
                "update_available": self._update_available,
            })

            return {
                "success": True,
                "current_build": self._baseline_steam_build,
                "latest_build": latest_build,
                "update_available": self._update_available,
                "current_tag": self.current_tag,
                "last_check": self._last_check.isoformat(),
                "steam_app_id": self.steam_app_id,
            }

        except Exception as e:
            logger.error(f"Error checking for updates: {e}", exc_info=True)
            await self._log_audit("update_check_failed", {"error": str(e)})
            return {
                "success": False,
                "error": str(e),
                "last_check": self._last_check.isoformat() if self._last_check else None,
            }

    async def mark_as_current(self) -> dict[str, Any]:
        """
        Mark the current Steam build as the installed baseline, clearing any pending
        update notification.  Call this after successfully running './dune update'.
        """
        if not self._latest_steam_build:
            # Do a fresh check first so we have a real build ID to store
            result = await self.check_for_updates()
            if not result.get("success"):
                return result

        self._baseline_steam_build = self._latest_steam_build
        self._update_available = False
        self._persist_state()

        logger.info(f"Baseline updated to Steam build {self._baseline_steam_build}")
        await self._log_audit("update_marked_current", {
            "baseline_build": self._baseline_steam_build,
        })
        return {
            "success": True,
            "baseline_build": self._baseline_steam_build,
            "message": "Server marked as up-to-date",
        }

    async def _log_audit(self, action: str, details: dict[str, Any]):
        """Log update-related actions to audit trail."""
        try:
            from db.database import SessionLocal
            from db.models import AuditLog
            
            async with SessionLocal() as session:
                entry = AuditLog(
                    action=action,
                    performed_by="UpdateService",
                    details=details,
                )
                session.add(entry)
                await session.commit()
        except Exception as e:
            logger.warning(f"Failed to log audit entry: {e}")

    async def _get_latest_build_id(self) -> Optional[str]:
        """Query Steam for the latest public build ID using host's steamcmd."""
        try:
            # Use the check-steam-build.sh script on the host
            script_path = "/workspace/scripts/check-steam-build.sh"
            
            result = await asyncio.create_subprocess_exec(
                "bash", script_path, self.steam_app_id,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await result.communicate()
            
            if result.returncode != 0:
                error_msg = stderr.decode().strip()
                logger.error(f"Steam build check failed: {error_msg}")
                return None
            
            build_id = stdout.decode().strip()
            
            if build_id and not build_id.startswith("ERROR"):
                logger.info(f"Found latest build ID: {build_id}")
                return build_id
            
            logger.warning(f"Could not determine build ID: {build_id}")
            return None
            
        except FileNotFoundError:
            logger.error("check-steam-build.sh script not found")
            return None
        except Exception as e:
            logger.error(f"Error querying Steam: {e}", exc_info=True)
            return None

    async def _get_installed_build_id(self) -> Optional[str]:
        """
        Get the currently installed build ID.
        Checks appmanifest file if available, otherwise returns current tag.
        """
        if not self.steam_dir:
            # Fall back to DUNE_IMAGE_TAG as a proxy
            return self.current_tag
        
        try:
            # Look for appmanifest file
            steam_path = Path(self.steam_dir)
            manifest_file = steam_path / f"steamapps/appmanifest_{self.steam_app_id}.acf"
            
            if manifest_file.exists():
                content = manifest_file.read_text()
                match = re.search(r'"buildid"\s+"(\d+)"', content)
                if match:
                    return match.group(1)
            
            # Fall back to current tag
            return self.current_tag
            
        except Exception as e:
            logger.warning(f"Error reading installed build ID: {e}")
            return self.current_tag


    async def trigger_update(self) -> dict[str, Any]:
        """
        Trigger a server update by calling the update.sh script.
        This is a long-running operation.
        """
        try:
            logger.info("Triggering server update via update.sh script")
            
            # Run update script
            script_path = Path(__file__).parent.parent.parent.parent / "scripts" / "update.sh"
            
            if not script_path.exists():
                return {
                    "success": False,
                    "error": "update.sh script not found",
                }
            
            # Note: This is a long-running operation that requires user input
            # In production, this should be run as a background job with proper handling
            return {
                "success": False,
                "error": "Automated updates not yet implemented. Please run './dune update' manually on the host.",
                "manual_command": "cd ~/dune-server-docker && ./dune update",
            }
            
        except Exception as e:
            logger.error(f"Error triggering update: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
            }

    def get_status(self) -> dict[str, Any]:
        """Get current update status from memory."""
        return {
            "current_tag": self.current_tag,
            "current_build": self._baseline_steam_build,
            "latest_build": self._latest_steam_build,
            "update_available": self._update_available,
            "last_check": self._last_check.isoformat() if self._last_check else None,
            "auto_update_enabled": self.auto_update_enabled,
            "check_interval_hours": self.check_interval,
            "steam_app_id": self.steam_app_id,
        }


# Global singleton
_update_service: Optional[UpdateService] = None


def get_update_service() -> UpdateService:
    """Get or create the global UpdateService instance."""
    global _update_service
    if _update_service is None:
        _update_service = UpdateService()
    return _update_service
