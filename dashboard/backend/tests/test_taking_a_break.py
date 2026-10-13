import asyncio
import json
import os
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

from middleware.auth import is_operator_path
from services.taking_a_break import (
    helper_installed,
    reset_state,
    run_taking_a_break,
    write_request,
)

REPO = Path(__file__).resolve().parents[3]
VALIDATOR = REPO / "scripts" / "taking_a_break_validate.py"
HOST = REPO / "scripts" / "taking-a-break-host.sh"


class ValidateRequestTests(unittest.TestCase):
    def test_operator_route(self):
        self.assertTrue(is_operator_path("/api/system/taking-a-break"))
        self.assertFalse(is_operator_path("/api/system/metrics"))

    def test_fresh_poweroff_request_is_valid(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "taking-a-break.request"
            write_request(Path(tmp), 5)
            completed = subprocess.run(
                ["python3", str(VALIDATOR), str(path), "900"],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_stale_request_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "request.json"
            path.write_text(json.dumps({"action": "poweroff", "requested_at_unix": 0}), encoding="utf-8")
            completed = subprocess.run(
                ["python3", str(VALIDATOR), str(path), "900"],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 1)
            self.assertIn("stale", completed.stderr)

    def test_helper_sentinel(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            self.assertFalse(helper_installed(folder))
            (folder / "taking-a-break.helper").write_text(json.dumps({"installed": True}), encoding="utf-8")
            self.assertTrue(helper_installed(folder))


class HostScriptTests(unittest.TestCase):
    def _run(self, data: Path, offsite: Path, shutdown_marker: Path) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env.update({
            "DUNE_BREAK_DATA": str(data),
            "DUNE_BREAK_RUN": str(data / "run"),
            "DUNE_OFFSITE_BACKUP": str(offsite),
            "DUNE_BREAK_SHUTDOWN_CMD": f"touch {shutdown_marker}",
            "DUNE_BREAK_MAX_AGE_SECONDS": "900",
        })
        return subprocess.run(
            ["bash", str(HOST)],
            check=False,
            capture_output=True,
            text=True,
            env=env,
        )

    def test_missing_offsite_script_does_not_power_off(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp)
            write_request(data, 5)
            marker = data / "powered-off"
            env = os.environ.copy()
            env.pop("DUNE_OFFSITE_BACKUP", None)
            env.update({
                "DUNE_BREAK_DATA": str(data),
                "DUNE_BREAK_RUN": str(data / "run"),
                "DUNE_BREAK_SHUTDOWN_CMD": f"touch {marker}",
                "DUNE_BREAK_MAX_AGE_SECONDS": "900",
            })
            completed = subprocess.run(
                ["bash", str(HOST)],
                check=False,
                capture_output=True,
                text=True,
                env=env,
            )
            self.assertNotEqual(completed.returncode, 0, completed.stderr)
            self.assertFalse(marker.exists())
            result = json.loads((data / "taking-a-break.result").read_text(encoding="utf-8"))
            self.assertEqual(result["status"], "error")
            self.assertIn("The host stayed on", result["message"])

    def test_offsite_failure_does_not_power_off(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp)
            write_request(data, 5)
            offsite = data / "offsite.sh"
            offsite.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
            offsite.chmod(offsite.stat().st_mode | stat.S_IEXEC)
            marker = data / "powered-off"
            completed = self._run(data, offsite, marker)
            self.assertNotEqual(completed.returncode, 0, completed.stderr)
            self.assertFalse(marker.exists())
            result = json.loads((data / "taking-a-break.result").read_text(encoding="utf-8"))
            self.assertEqual(result["status"], "error")
            self.assertFalse((data / "taking-a-break.request").exists())

    def test_success_powers_off_after_offsite_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp)
            write_request(data, 5)
            offsite = data / "offsite.sh"
            offsite.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            offsite.chmod(offsite.stat().st_mode | stat.S_IEXEC)
            marker = data / "powered-off"
            completed = self._run(data, offsite, marker)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertTrue(marker.exists())
            result = json.loads((data / "taking-a-break.result").read_text(encoding="utf-8"))
            self.assertEqual(result["status"], "powering_off")
            self.assertFalse((data / "taking-a-break.request").exists())

    def test_stale_request_does_not_power_off(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp)
            (data / "taking-a-break.request").write_text(
                json.dumps({"action": "poweroff", "requested_at_unix": time.time() - 10_000}),
                encoding="utf-8",
            )
            offsite = data / "offsite.sh"
            offsite.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            offsite.chmod(offsite.stat().st_mode | stat.S_IEXEC)
            marker = data / "powered-off"
            completed = self._run(data, offsite, marker)
            self.assertNotEqual(completed.returncode, 0)
            self.assertFalse(marker.exists())
            self.assertFalse((data / "taking-a-break.request").exists())


class BreakSequenceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        reset_state()

    async def test_stop_failure_does_not_request_poweroff(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)

            class Docker:
                async def stop_container(self, name, timeout=10):
                    if name.endswith("survival_1-1"):
                        raise RuntimeError("stop refused")

            class Backup:
                async def create_backup(self, scope="full"):
                    raise AssertionError("backup should not run")

            await run_taking_a_break(
                warning_minutes=0,
                docker_service=Docker(),
                backup_service=Backup(),
                announce_service=SimpleNamespace(send_announcement=lambda message: None),
                discord_service=None,
                directory=folder,
            )
            from services.taking_a_break import BREAK_STATE

            self.assertEqual(BREAK_STATE["phase"], "error")
            self.assertFalse((folder / "taking-a-break.request").exists())

    async def test_backup_failure_does_not_request_poweroff(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            stopped: list[str] = []

            class Docker:
                async def stop_container(self, name, timeout=10):
                    stopped.append(name)

            class Backup:
                async def create_backup(self, scope="full"):
                    raise RuntimeError("disk full")

            await run_taking_a_break(
                warning_minutes=0,
                docker_service=Docker(),
                backup_service=Backup(),
                announce_service=SimpleNamespace(send_announcement=lambda message: None),
                discord_service=None,
                directory=folder,
            )
            from services.taking_a_break import BREAK_STATE

            self.assertEqual(BREAK_STATE["phase"], "error")
            self.assertIn("Local backup failed", BREAK_STATE["error"])
            self.assertFalse((folder / "taking-a-break.request").exists())
            self.assertTrue(any(name.endswith("survival_1-1") for name in stopped))

    async def test_success_waits_for_host_poweroff(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)

            class Docker:
                async def stop_container(self, name, timeout=10):
                    return None

            class Backup:
                async def create_backup(self, scope="full"):
                    return SimpleNamespace(filename="dune-db.sql.gz")

            async def pretend_host():
                for _ in range(50):
                    if (folder / "taking-a-break.request").exists():
                        (folder / "taking-a-break.result").write_text(
                            json.dumps({"status": "ack", "message": "Host helper started."}),
                            encoding="utf-8",
                        )
                        await asyncio.sleep(0.05)
                        (folder / "taking-a-break.result").write_text(
                            json.dumps({"status": "powering_off", "message": "Powering off."}),
                            encoding="utf-8",
                        )
                        return
                    await asyncio.sleep(0.05)

            host = asyncio.create_task(pretend_host())
            await run_taking_a_break(
                warning_minutes=0,
                docker_service=Docker(),
                backup_service=Backup(),
                announce_service=SimpleNamespace(send_announcement=lambda message: None),
                discord_service=None,
                directory=folder,
                ack_timeout=5,
                total_timeout=10,
            )
            await host
            from services.taking_a_break import BREAK_STATE

            self.assertEqual(BREAK_STATE["phase"], "powering_off")


if __name__ == "__main__":
    unittest.main()
