import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from services.update_service import UpdateService


class FakeProcess:
    def __init__(self, stdout: bytes = b"", stderr: bytes = b"", returncode: int = 0):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode

    async def communicate(self):
        return self.stdout, self.stderr


class UpdateServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.service = object.__new__(UpdateService)
        self.service._docker_environment = lambda: {}

    async def test_discovers_host_project_directory_from_dashboard_label(self):
        processes = [
            FakeProcess(stdout=b"dashboard-container-id\n"),
            FakeProcess(stdout=b"/home/operator/dune-server-docker\n"),
        ]

        with patch(
            "services.update_service.asyncio.create_subprocess_exec",
            new=AsyncMock(side_effect=processes),
        ):
            project_dir, error = await self.service._discover_host_project_dir("/usr/bin/docker")

        self.assertIsNone(error)
        self.assertEqual(str(project_dir), "/home/operator/dune-server-docker")

    async def test_discovers_only_services_using_dynamic_image_tag(self):
        config = {
            "services": {
                "game-rmq": {
                    "image": "funcom/self-hosting/seabass-server-rabbitmq:2064155-0-shipping"
                },
                "postgres": {
                    "image": "funcom/self-hosting/igw-postgres:17.4-alpine-fc-13"
                },
                "dashboard-api": {"image": "dune-awakening-dashboard-api"},
            }
        }
        proc = FakeProcess(stdout=json.dumps(config).encode())
        proc_env = {"DUNE_IMAGE_TAG": "2064155-0-shipping"}

        with patch(
            "services.update_service.asyncio.create_subprocess_exec",
            new=AsyncMock(return_value=proc),
        ) as create_subprocess:
            services, error = await self.service._discover_tagged_services(
                ["/usr/bin/docker", "compose"],
                "2064155-0-shipping",
                proc_env,
            )

        self.assertIsNone(error)
        self.assertEqual(services, ["game-rmq"])
        self.assertIs(create_subprocess.await_args.kwargs["env"], proc_env)

    def test_compose_failure_detail_prefers_mount_error(self):
        output = "\n".join(
            [
                "Container dune-awakening-admin-rmq-1 Recreate",
                "Container dune-awakening-admin-rmq-1 Recreated",
                "Error response from daemon: failed to mount source: not a directory",
            ]
        )

        detail = self.service._compose_failure_detail(output)

        self.assertEqual(
            detail,
            "Error response from daemon: failed to mount source: not a directory",
        )

    def test_image_tag_match_is_exact(self):
        image = "funcom/self-hosting/seabass-server:2064155-0-shipping"

        self.assertTrue(self.service._image_uses_tag(image, "2064155-0-shipping"))
        self.assertFalse(self.service._image_uses_tag(image, "2064155"))

    def _compose_tree(self) -> tuple[Path, Path]:
        tmp = Path(tempfile.mkdtemp())
        for name in (
            "docker-compose.yml",
            "docker-compose.basic.yml",
            "docker-compose.standard.yml",
            "docker-compose.standard-lean.yml",
            "docker-compose.hostnet-lean.yml",
            "docker-compose.dashboard.yml",
        ):
            (tmp / name).write_text("services: {}\n")
        env_file = tmp / ".env"
        return tmp, env_file

    def _resolve(self, compose_dir: Path, env_file: Path, environ: dict[str, str]):
        cleared = {
            "COMPOSE_FILE": "",
            "DUNE_HOSTNET_OVERLAY": "",
            "DEPLOYMENT_PROFILE": "",
            "DUNE_COMPOSE_OVERLAY": "",
        }
        cleared.update(environ)
        with patch.dict(os.environ, cleared, clear=False):
            return self.service._resolve_compose_files(compose_dir, env_file)

    def test_complete_lean_hostnet_dashboard_is_accepted(self):
        compose_dir, env_file = self._compose_tree()
        env_file.write_text(
            "\n".join(
                [
                    "DEPLOYMENT_PROFILE=standard-lean",
                    "DUNE_HOSTNET_OVERLAY=docker-compose.hostnet-lean.yml",
                    "COMPOSE_FILE=docker-compose.yml:docker-compose.standard-lean.yml:docker-compose.hostnet-lean.yml:docker-compose.dashboard.yml",
                    "",
                ]
            )
        )

        files, errors = self._resolve(compose_dir, env_file, {})
        names = [path.name for path in files]

        self.assertEqual(errors, [])
        self.assertEqual(
            names,
            [
                "docker-compose.yml",
                "docker-compose.standard-lean.yml",
                "docker-compose.hostnet-lean.yml",
                "docker-compose.dashboard.yml",
            ],
        )
        self.assertNotIn("docker-compose.basic.yml", names)
        self.assertNotIn("docker-compose.standard.yml", names)

    def test_partial_compose_file_missing_dashboard_is_refused(self):
        compose_dir, env_file = self._compose_tree()
        env_file.write_text(
            "COMPOSE_FILE=docker-compose.yml:docker-compose.standard-lean.yml\n"
            "DEPLOYMENT_PROFILE=standard-lean\n"
        )

        files, errors = self._resolve(compose_dir, env_file, {})
        self.assertTrue(any("docker-compose.dashboard.yml" in error for error in errors))
        self.assertIn("docker-compose.standard-lean.yml", [path.name for path in files])

    def test_partial_compose_file_missing_hostnet_is_refused(self):
        compose_dir, env_file = self._compose_tree()
        env_file.write_text(
            "COMPOSE_FILE=docker-compose.yml:docker-compose.standard-lean.yml:docker-compose.dashboard.yml\n"
            "DEPLOYMENT_PROFILE=standard-lean\n"
            "DUNE_HOSTNET_OVERLAY=docker-compose.hostnet-lean.yml\n"
        )

        _files, errors = self._resolve(compose_dir, env_file, {})
        self.assertTrue(any("hostnet-lean" in error for error in errors))

    def test_conflicting_profile_overlay_is_refused(self):
        compose_dir, env_file = self._compose_tree()
        env_file.write_text(
            "COMPOSE_FILE=docker-compose.yml:docker-compose.standard.yml:docker-compose.dashboard.yml\n"
            "DEPLOYMENT_PROFILE=standard-lean\n"
        )

        _files, errors = self._resolve(compose_dir, env_file, {})
        self.assertTrue(any("docker-compose.standard.yml" in error and "standard-lean" in error for error in errors))

    def test_missing_compose_file_uses_lean_profile_not_basic(self):
        compose_dir, env_file = self._compose_tree()
        env_file.write_text(
            "DEPLOYMENT_PROFILE=standard-lean\n"
            "DUNE_HOSTNET_OVERLAY=docker-compose.hostnet-lean.yml\n"
        )

        files, errors = self._resolve(compose_dir, env_file, {})
        names = [path.name for path in files]

        self.assertEqual(errors, [])
        self.assertIn("docker-compose.standard-lean.yml", names)
        self.assertIn("docker-compose.hostnet-lean.yml", names)
        self.assertIn("docker-compose.dashboard.yml", names)
        self.assertNotIn("docker-compose.basic.yml", names)


if __name__ == "__main__":
    unittest.main()
