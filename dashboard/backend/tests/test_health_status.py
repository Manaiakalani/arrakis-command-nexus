import unittest
from types import SimpleNamespace

from services.health_status import (
    is_init_container,
    readiness_to_health,
    service_to_frontend,
)
from services.player_tracker import diff_online_players


class HealthStatusTests(unittest.TestCase):
    def test_running_container_is_healthy(self):
        svc = SimpleNamespace(name="dune-awakening-survival_1-1", status="running", health="healthy", latency_ms=12)
        payload = service_to_frontend(svc)
        self.assertEqual(payload["status"], "healthy")
        self.assertEqual(payload["label"], "Survival 1")
        self.assertFalse(payload["isInit"])
        self.assertEqual(payload["latencyMs"], 12)

    def test_unhealthy_running_container_is_degraded(self):
        svc = SimpleNamespace(name="dune-awakening-gateway-1", status="running", health="unhealthy", latency_ms=0)
        self.assertEqual(service_to_frontend(svc)["status"], "degraded")

    def test_db_init_exited_zero_is_completed_not_offline(self):
        svc = SimpleNamespace(name="dune-awakening-db-init-1", status="exited", health=None, latency_ms=0)
        payload = service_to_frontend(svc)
        self.assertEqual(payload["status"], "completed")
        self.assertTrue(payload["isInit"])
        self.assertEqual(payload["message"], "Finished successfully")

    def test_error_status_is_offline(self):
        svc = SimpleNamespace(name="dune-awakening-overmap-1", status="error", health=None, latency_ms=0)
        self.assertEqual(service_to_frontend(svc)["status"], "offline")

    def test_init_name_variants(self):
        self.assertTrue(is_init_container("dune-awakening-db-init-1"))
        self.assertTrue(is_init_container("db_init"))
        self.assertFalse(is_init_container("dune-awakening-postgres-1"))

    def test_readiness_mapping(self):
        self.assertEqual(readiness_to_health("ok"), "healthy")
        self.assertEqual(readiness_to_health("warn"), "degraded")
        self.assertEqual(readiness_to_health("fail"), "offline")
        self.assertEqual(readiness_to_health("mystery"), "offline")


class PlayerTrackerDiffTests(unittest.TestCase):
    def test_first_poll_emits_no_joins(self):
        joined, left, nxt = diff_online_players(set(), {"a", "b"}, first_poll=True)
        self.assertEqual(joined, set())
        self.assertEqual(left, set())
        self.assertEqual(nxt, {"a", "b"})

    def test_join_and_leave(self):
        joined, left, nxt = diff_online_players({"a", "b"}, {"b", "c"}, first_poll=False)
        self.assertEqual(joined, {"c"})
        self.assertEqual(left, {"a"})
        self.assertEqual(nxt, {"b", "c"})

    def test_no_change(self):
        joined, left, nxt = diff_online_players({"a"}, {"a"}, first_poll=False)
        self.assertEqual(joined, set())
        self.assertEqual(left, set())
        self.assertEqual(nxt, {"a"})


class KnownTemplateAdditionsTests(unittest.TestCase):
    def test_live_world_ids_are_in_catalog(self):
        from services.character_service import CharacterService

        for template_id in (
            "HarkAr7",
            "AtreLMG5",
            "CHOAMSword_3",
            "RocketLauncher_2",
            "SmugDmr4",
            "Radiation_Suit_T5",
            "MelangeSpice",
            "HarkAr6",
            "AtreLMG4",
            "RocketLauncher_3",
            "Combat_Choam_Light06_Helmet",
            "Stillsuit_Unique_Efficient_05_Top",
            "Combat_Neut_AtreidesDeserterUnique03_Top_Schematic",
            "HeavyPistol_Unique_Bleed_03_Schematic",
            "Stillsuit_Unique_Armored_01_Boots_Schematic",
        ):
            self.assertIn(template_id, CharacterService.KNOWN_TEMPLATES)


if __name__ == "__main__":
    unittest.main()
