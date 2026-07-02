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
        self.steam_app_id = os.getenv("STEAM_APP_ID", "4754530")
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

            # Reconcile baseline with appmanifest. If the appmanifest shows a
            # newer build than our persisted baseline (e.g. after an OOM during
            # image loading), adopt the appmanifest value as the true baseline.
            installed = await self._get_installed_build_id()
            if not self._baseline_steam_build:
                if installed and installed.isdigit():
                    self._baseline_steam_build = installed
                    logger.info(
                        "Bootstrap baseline from appmanifest: installed=%s, latest=%s",
                        installed, latest_build,
                    )
                else:
                    self._baseline_steam_build = latest_build
                    logger.warning(
                        "No installed build readable from appmanifest – falling "
                        "back to latest Steam build %s as baseline. If the host "
                        "actually has an older build installed, run /api/updates/check "
                        "again after fixing DUNE_STEAM_SERVER_DIR.",
                        latest_build,
                    )
            elif installed and installed.isdigit():
                baseline_int = int(self._baseline_steam_build) if self._baseline_steam_build.isdigit() else 0
                if int(installed) > baseline_int:
                    logger.info(
                        "Appmanifest build %s is newer than persisted baseline %s — adopting",
                        installed, self._baseline_steam_build,
                    )
                    self._baseline_steam_build = installed

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
        Trigger a server update:
          1. Download the latest server files via steamcmd.
          2. Load the new Docker image tarballs.
          3. Update DUNE_IMAGE_TAG in .env.
          4. Restart game server containers.
          5. Mark the new Steam build as the installed baseline.
        """
        steam_dir = self.steam_dir or "/workspace/steam"
        steam_app_id = self.steam_app_id
        env_file = Path("/workspace/.env")

        try:
            logger.info("Auto-update: downloading server files via steamcmd (app_id=%s, dir=%s)", steam_app_id, steam_dir)

            # Ensure target directory exists
            Path(steam_dir).mkdir(parents=True, exist_ok=True)

            # Run steamcmd to download new server files
            steamcmd_bin = self._find_steamcmd()
            if not steamcmd_bin:
                return {"success": False, "error": "steamcmd not found in container"}

            proc = await asyncio.create_subprocess_exec(
                steamcmd_bin,
                "+@sSteamCmdForcePlatformType", "linux",
                "+force_install_dir", steam_dir,
                "+login", "anonymous",
                "+app_update", steam_app_id, "validate",
                "+quit",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout_bytes, stderr_bytes = await asyncio.wait_for(proc.communicate(), timeout=1800)
            stdout_text = stdout_bytes.decode("utf-8", errors="replace") if stdout_bytes else ""
            if proc.returncode != 0:
                err = stderr_bytes.decode("utf-8", errors="replace") if stderr_bytes else "unknown"
                logger.error("steamcmd failed (rc=%d): %s", proc.returncode, err[:500])
                return {"success": False, "error": f"steamcmd failed (rc={proc.returncode}): {err[:200]}"}
            logger.info("steamcmd completed successfully")

            # Find Docker image tarballs
            import glob as _glob
            tarballs = sorted(
                _glob.glob(f"{steam_dir}/**/*.tar", recursive=True)
                + _glob.glob(f"{steam_dir}/**/*.tar.gz", recursive=True)
            )
            if not tarballs:
                return {"success": False, "error": f"No Docker image tarballs found under {steam_dir} after steamcmd update"}

            # Load images via `docker load` CLI to avoid reading large tarballs into memory
            loaded_tags: list[str] = []
            for tarball in tarballs:
                logger.info("Loading Docker image: %s", tarball)
                try:
                    load_proc = await asyncio.create_subprocess_exec(
                        "docker", "load", "-i", tarball,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    load_out, load_err = await asyncio.wait_for(load_proc.communicate(), timeout=600)
                    out_text = load_out.decode("utf-8", errors="replace") if load_out else ""
                    if load_proc.returncode != 0:
                        err_text = load_err.decode("utf-8", errors="replace") if load_err else "unknown"
                        logger.warning("Failed to load %s (rc=%d): %s", tarball, load_proc.returncode, err_text[:200])
                        continue
                    # Parse "Loaded image: <tag>" lines
                    for line in out_text.splitlines():
                        if "Loaded image:" in line:
                            tag = line.split("Loaded image:", 1)[1].strip()
                            loaded_tags.append(tag)
                            logger.info("Loaded image tags: %s", [tag])
                except Exception as exc:
                    logger.warning("Failed to load %s: %s", tarball, exc)

            # Retag registry-prefixed images to match docker-compose short names
            # Steam packages use "registry.funcom.com/funcom/self-hosting/..." but
            # compose references "funcom/self-hosting/..."
            for full_tag in list(loaded_tags):
                if full_tag.startswith("registry.funcom.com/"):
                    short_tag = full_tag.replace("registry.funcom.com/", "", 1)
                    retag_proc = await asyncio.create_subprocess_exec(
                        "docker", "tag", full_tag, short_tag,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    await retag_proc.communicate()
                    if retag_proc.returncode == 0:
                        loaded_tags.append(short_tag)
                        logger.info("Retagged %s -> %s", full_tag, short_tag)

            # Determine new image tag (prefer seabass-server / dune images)
            new_tag = ""
            for ref in loaded_tags:
                if "seabass-server" in ref or "dune" in ref.lower():
                    new_tag = ref.split(":")[-1]
                    break
            if not new_tag and loaded_tags:
                new_tag = loaded_tags[-1].split(":")[-1]

            if new_tag:
                # Update DUNE_IMAGE_TAG in .env
                if env_file.exists():
                    lines = env_file.read_text(encoding="utf-8").splitlines(keepends=True)
                    updated = False
                    for i, line in enumerate(lines):
                        if line.startswith("DUNE_IMAGE_TAG="):
                            lines[i] = f"DUNE_IMAGE_TAG={new_tag}\n"
                            updated = True
                            break
                    if not updated:
                        lines.append(f"DUNE_IMAGE_TAG={new_tag}\n")
                    env_file.write_text("".join(lines), encoding="utf-8")
                    logger.info("Updated DUNE_IMAGE_TAG=%s in .env", new_tag)

                self.current_tag = new_tag

            # Restart game server containers (survival_1, overmap, etc.)
            restarted = []
            errors = {}
            try:
                containers = await docker_svc.list_containers()
                game_containers = [
                    c for c in containers
                    if any(kw in (c.name or "").lower() for kw in ("survival", "overmap", "sietch"))
                ]
                for container in game_containers:
                    try:
                        await docker_svc.restart_container(container.name)
                        restarted.append(container.name)
                        logger.info("Restarted container: %s", container.name)
                    except Exception as exc:
                        errors[container.name] = str(exc)
                        logger.warning("Failed to restart %s: %s", container.name, exc)
            except Exception as exc:
                logger.warning("Container restart phase failed: %s", exc)

            # Mark new build as current baseline
            if self._latest_steam_build:
                self._baseline_steam_build = self._latest_steam_build
            self._update_available = False
            self._last_check = datetime.now()
            self._persist_state()

            await self._log_audit("update_triggered", {
                "new_tag": new_tag,
                "loaded_tags": loaded_tags,
                "restarted": restarted,
                "errors": errors,
                "steam_dir": steam_dir,
            })

            return {
                "success": True,
                "new_tag": new_tag,
                "loaded_tags": loaded_tags,
                "restarted": restarted,
                "errors": errors,
            }

        except asyncio.TimeoutError:
            return {"success": False, "error": "Update timed out (30 minute limit exceeded)"}
        except Exception as exc:
            logger.error("trigger_update failed: %s", exc, exc_info=True)
            await self._log_audit("update_trigger_failed", {"error": str(exc)})
            return {"success": False, "error": str(exc)}

    def _find_steamcmd(self) -> str | None:
        """Find the steamcmd binary in common locations."""
        import shutil
        candidates = [
            "/home/app/steamcmd/steamcmd.sh",
            "/usr/local/bin/steamcmd",
            "/usr/games/steamcmd",
        ]
        for path in candidates:
            if Path(path).exists():
                return path
        found = shutil.which("steamcmd")
        return found

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
