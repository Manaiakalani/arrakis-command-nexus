import json
import unittest
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

        with patch(
            "services.update_service.asyncio.create_subprocess_exec",
            new=AsyncMock(return_value=proc),
        ):
            services, error = await self.service._discover_tagged_services(
                ["/usr/bin/docker", "compose"],
                "2064155-0-shipping",
            )

        self.assertIsNone(error)
        self.assertEqual(services, ["game-rmq"])

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


if __name__ == "__main__":
    unittest.main()
