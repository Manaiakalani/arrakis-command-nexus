import re
import unittest
from pathlib import Path

from services.character_service import CharacterService
from services.grant_resolution import (
    GHOST_RECIPE_IDS,
    classify_grant_template,
    recipe_tail,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
CATALOG_PATH = REPO_ROOT / "dashboard/frontend/src/lib/grant-catalog.ts"


def catalog_template_ids() -> set[str]:
    return set(re.findall(r'templateId:\s*"([^"]+)"', CATALOG_PATH.read_text(encoding="utf-8")))


class GrantResolutionTests(unittest.TestCase):
    def test_exact_match_is_case_sensitive(self):
        live = "Combat_Choam_Light06_Helmet"
        decision = classify_grant_template(
            "combat_choam_light06_helmet",
            in_items_exact=False,
            tail_match=None,
            in_known=False,
        )
        self.assertEqual(decision.outcome, "unknown")

        exact = classify_grant_template(
            live,
            in_items_exact=True,
            tail_match=None,
            in_known=True,
        )
        self.assertEqual(exact.outcome, "exact")
        self.assertEqual(exact.template_id, live)
        self.assertIsNone(exact.note)

    def test_recipe_style_tail_resolves_to_item_id(self):
        decision = classify_grant_template(
            "T2_Material_Silicone",
            in_items_exact=False,
            tail_match="Silicone",
            in_known=False,
        )
        self.assertEqual(decision.outcome, "recipe_tail")
        self.assertEqual(decision.template_id, "Silicone")
        self.assertIn("T2_Material_Silicone", decision.note or "")

    def test_known_unconfirmed_keeps_requested_id(self):
        decision = classify_grant_template(
            "HarkAr7",
            in_items_exact=False,
            tail_match=None,
            in_known=True,
        )
        self.assertEqual(decision.outcome, "known_unconfirmed")
        self.assertEqual(decision.template_id, "HarkAr7")

    def test_recipe_tail_helper(self):
        self.assertEqual(recipe_tail("T2_Material_Silicone"), "Silicone")
        self.assertIsNone(recipe_tail("Silicone"))


class GrantCatalogInvariantTests(unittest.TestCase):
    def test_catalog_ids_are_exact_known_templates(self):
        ids = catalog_template_ids()
        self.assertGreater(len(ids), 100)
        missing = sorted(ids - set(CharacterService.KNOWN_TEMPLATES))
        self.assertEqual(missing, [], f"catalog IDs missing from KNOWN_TEMPLATES: {missing}")

    def test_catalog_has_no_ghost_recipe_ids(self):
        ids = catalog_template_ids()
        ghosts = sorted(ids & GHOST_RECIPE_IDS)
        self.assertEqual(ghosts, [], f"catalog still ships ghost recipe IDs: {ghosts}")

    def test_known_templates_keep_ghosts_out_of_grant_buttons_only(self):
        # Back-compat aliases may remain in KNOWN_TEMPLATES; buttons must not.
        self.assertTrue(GHOST_RECIPE_IDS.isdisjoint(catalog_template_ids()))


if __name__ == "__main__":
    unittest.main()
