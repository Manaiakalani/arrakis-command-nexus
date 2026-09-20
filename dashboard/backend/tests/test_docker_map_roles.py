import unittest
from types import SimpleNamespace

from services.docker_service import DockerService


class DockerMapRoleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.docker = DockerService(base_url="unix:///dev/null")

    def test_count_includes_hubs_not_just_survival_and_overmap(self) -> None:
        services = [
            SimpleNamespace(name="dune-awakening-survival_1-1", status="running"),
            SimpleNamespace(name="dune-awakening-overmap-1", status="running"),
            SimpleNamespace(name="dune-awakening-arrakeen-1", status="running"),
            SimpleNamespace(name="dune-awakening-harko_village-1", status="running"),
            SimpleNamespace(name="dune-awakening-director-1", status="running"),
            SimpleNamespace(name="dune-awakening-deep_desert_1-1", status="exited"),
        ]
        self.assertEqual(self.docker.count_running_maps(services), 4)

    def test_stopped_maps_are_not_active(self) -> None:
        services = [
            SimpleNamespace(name="dune-awakening-arrakeen-1", status="exited"),
            SimpleNamespace(name="dune-awakening-survival_1-1", status="running"),
        ]
        self.assertEqual(self.docker.count_running_maps(services), 1)


if __name__ == "__main__":
    unittest.main()
