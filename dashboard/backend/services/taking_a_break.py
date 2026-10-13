"""Taking a break: warn, save, copy offsite, then ask the host to power off.

The dashboard cannot power the machine off itself. After the local backup
succeeds it writes a request file. A host path unit runs the offsite copy and
refuses to halt if that copy fails.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from docker.errors import NotFound

logger = logging.getLogger(__name__)

# Map and infra containers. Postgres, the dashboard, and the socket proxy stay
# up so the local dump and the offsite pg_dumpall can finish.
GAME_CONTAINERS = (
    "dune-awakening-survival_1-1",
    "dune-awakening-overmap-1",
    "dune-awakening-deepdesert_1-1",
    "dune-awakening-arrakeen-1",
    "dune-awakening-harko_village-1",
)
INFRA_CONTAINERS = (
    "dune-awakening-director-1",
    "dune-awakening-gateway-1",
    "dune-awakening-text-router-1",
    "dune-awakening-rmq-auth-shim-1",
    "dune-awakening-game-rmq-1",
    "dune-awakening-admin-rmq-1",
    "dune-awakening-partition-repair-1",
    "dune-awakening-seed-guardian-1",
)

BREAK_STATE: dict[str, Any] = {"phase": "idle", "details": []}

REQUEST_NAME = "taking-a-break.request"
RESULT_NAME = "taking-a-break.result"
HELPER_NAME = "taking-a-break.helper"


def data_dir() -> Path:
    return Path(os.getenv("DUNE_BREAK_DATA", "/workspace/data"))


def reset_state() -> None:
    BREAK_STATE.clear()
    BREAK_STATE.update({"phase": "idle", "details": []})


def helper_installed(directory: Path | None = None) -> bool:
    path = (directory or data_dir()) / HELPER_NAME
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return False
    return isinstance(payload, dict) and payload.get("installed") is True


def write_request(directory: Path, warning_minutes: int) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    payload = {
        "action": "poweroff",
        "requested_at_unix": time.time(),
        "warning_minutes": warning_minutes,
    }
    target = directory / REQUEST_NAME
    tmp = directory / f".{REQUEST_NAME}.{os.getpid()}.tmp"
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    os.chmod(tmp, 0o644)
    tmp.replace(target)


def clear_exchange(directory: Path) -> None:
    for name in (REQUEST_NAME, RESULT_NAME):
        try:
            (directory / name).unlink()
        except FileNotFoundError:
            pass


def read_result(directory: Path) -> dict[str, Any] | None:
    path = directory / RESULT_NAME
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _missing_container(exc: BaseException) -> bool:
    if isinstance(exc, NotFound):
        return True
    msg = str(exc)
    return "404" in msg or "No such container" in msg or "not found" in msg.lower()


async def _stop_one(docker_service: Any, name: str, timeout: int) -> str:
    try:
        await docker_service.stop_container(name, timeout=timeout)
    except KeyError:
        return "skipped"
    except Exception as exc:  # noqa: BLE001
        if _missing_container(exc):
            return "skipped"
        logger.error("Stop %s failed: %s", name, exc, exc_info=True)
        return "failed"
    return "stopped"


async def run_taking_a_break(
    *,
    warning_minutes: int,
    docker_service: Any,
    backup_service: Any,
    announce_service: Any,
    discord_service: Any | None,
    directory: Path | None = None,
    ack_timeout: float = 45,
    total_timeout: float = 1800,
) -> None:
    """Background sequence. Never powers off when a backup fails."""
    folder = directory or data_dir()
    BREAK_STATE.clear()
    BREAK_STATE.update({
        "phase": "warning",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "warning_minutes": warning_minutes,
        "details": [],
        "error": None,
    })

    async def step(msg: str) -> None:
        logger.info("[taking-a-break] %s", msg)
        BREAK_STATE["details"].append({
            "ts": datetime.now(timezone.utc).isoformat(),
            "msg": msg,
        })

    try:
        clear_exchange(folder)
        if discord_service is not None:
            try:
                await discord_service.enqueue(
                    "scheduled_restart",
                    (
                        f"Taking a break in **{warning_minutes} minute(s)**.\n"
                        "The world is saved locally and copied off the machine, then the host powers off.\n"
                        "If a backup fails, the host stays on."
                    ),
                    title="Taking a break",
                )
            except Exception:  # noqa: BLE001
                logger.exception("Failed to enqueue Discord break notification")

        total_seconds = warning_minutes * 60
        if warning_minutes > 0:
            message = (
                f"Server is taking a break in {warning_minutes} minute(s). "
                "Log out safely. Bases stay as they are."
            )
        else:
            message = "Server is taking a break now. Bases stay as they are."
        BREAK_STATE["phase"] = "warning"
        await step(f"Announcing: {message}")
        try:
            await asyncio.to_thread(announce_service.send_announcement, message)
        except Exception:  # noqa: BLE001
            logger.exception("Break announcement failed (continuing)")

        if warning_minutes >= 2:
            await asyncio.sleep(max(total_seconds - 60, 0))
            await step("Announcing: Server taking a break in 1 minute. Please log out safely.")
            try:
                await asyncio.to_thread(
                    announce_service.send_announcement,
                    "Server taking a break in 1 minute. Please log out safely.",
                )
            except Exception:  # noqa: BLE001
                logger.exception("One-minute announcement failed (continuing)")
            await asyncio.sleep(50)
        elif total_seconds > 0:
            await asyncio.sleep(total_seconds)

        if total_seconds >= 10 and warning_minutes >= 2:
            await step("Announcing: Server taking a break in 10 seconds.")
            try:
                await asyncio.to_thread(
                    announce_service.send_announcement,
                    "Server taking a break in 10 seconds. Goodbye.",
                )
            except Exception:  # noqa: BLE001
                logger.exception("Final announcement failed (continuing)")
            await asyncio.sleep(10)

        BREAK_STATE["phase"] = "stopping_game"
        await step("Stopping game servers so the save is quiet.")
        for name, timeout in (
            *((name, 45) for name in GAME_CONTAINERS),
            *((name, 20) for name in INFRA_CONTAINERS),
        ):
            outcome = await _stop_one(docker_service, name, timeout)
            if outcome == "failed":
                BREAK_STATE["phase"] = "error"
                BREAK_STATE["error"] = (
                    f"Could not stop {name}. The host stayed on. "
                    "Some game servers may already be stopped."
                )
                await step(BREAK_STATE["error"])
                return
            if outcome == "stopped":
                await step(f"Stopped {name}")
            else:
                await step(f"Skipped {name} (not deployed on this profile)")

        BREAK_STATE["phase"] = "backup"
        await step("Creating the local backup.")
        try:
            entry = await backup_service.create_backup(scope="full")
        except Exception:  # noqa: BLE001
            logger.exception("Local break backup failed")
            BREAK_STATE["phase"] = "error"
            BREAK_STATE["error"] = (
                "Local backup failed. The host stayed on. "
                "Some game servers may already be stopped. Start the server again from this page."
            )
            await step(BREAK_STATE["error"])
            return
        await step(f"Local backup ok: {getattr(entry, 'filename', 'unknown')}")

        BREAK_STATE["phase"] = "offsite"
        await step("Asking the host to copy the world off this machine, then power off.")
        write_request(folder, warning_minutes)

        deadline_ack = time.monotonic() + ack_timeout
        deadline = time.monotonic() + total_timeout
        saw_ack = False
        while time.monotonic() < deadline:
            result = read_result(folder)
            status = (result or {}).get("status")
            message = str((result or {}).get("message") or "")
            if status == "ack" and not saw_ack:
                saw_ack = True
                await step(message or "Host helper started.")
            elif status == "powering_off":
                BREAK_STATE["phase"] = "powering_off"
                await step(message or "Powering off.")
                return
            elif status == "error":
                BREAK_STATE["phase"] = "error"
                BREAK_STATE["error"] = message or "Offsite backup failed. The host stayed on."
                await step(BREAK_STATE["error"])
                return
            if not saw_ack and time.monotonic() > deadline_ack:
                clear_exchange(folder)
                BREAK_STATE["phase"] = "error"
                BREAK_STATE["error"] = "The host helper did not start. The host stayed on."
                await step(BREAK_STATE["error"])
                return
            await asyncio.sleep(1)

        BREAK_STATE["phase"] = "error"
        BREAK_STATE["error"] = "Offsite copy did not finish in time. Check the host before assuming it stayed on."
        await step(BREAK_STATE["error"])
    except Exception:  # noqa: BLE001
        logger.exception("Taking a break failed")
        BREAK_STATE["phase"] = "error"
        BREAK_STATE["error"] = "Taking a break failed. The host stayed on. Check server logs."
        BREAK_STATE["details"].append({
            "ts": datetime.now(timezone.utc).isoformat(),
            "msg": BREAK_STATE["error"],
        })
