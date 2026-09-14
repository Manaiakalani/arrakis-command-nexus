"""Pure grant-template resolution (no database).

The game instantiates inventory rows by item ``template_id``, not by crafting
recipe name. A case-sensitive miss or a recipe-style grant writes a ghost slot
the client cannot render. Callers do the lookups; this module decides.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

# Recipe / wiki names that have granted invisible stacks. Catalog buttons must
# not ship these; KNOWN_TEMPLATES may keep them only as back-compat aliases.
GHOST_RECIPE_IDS = frozenset({
    "T1_Tool_Binoculars",
    "T2_MiscEquipment_PowerPack",
    "T2_Material_Silicone",
    "T3_Material_CopperBar",
})

RECIPE_NOTE = (
    "Resolved '{requested}' to item template '{resolved}'. "
    "(The original is a crafting-recipe/tier name, which the "
    "game does not render directly as an item.)"
)

Outcome = Literal["exact", "recipe_tail", "known_unconfirmed", "unknown"]


@dataclass(frozen=True)
class GrantResolution:
    template_id: str
    note: str | None
    outcome: Outcome


def recipe_tail(template_id: str) -> str | None:
    """Trailing segment of a recipe-style id (``T2_Material_Silicone`` → ``Silicone``)."""
    if "_" not in template_id:
        return None
    tail = template_id.rsplit("_", 1)[-1]
    return tail or None


def classify_grant_template(
    requested: str,
    *,
    in_items_exact: bool,
    tail_match: str | None,
    in_known: bool,
) -> GrantResolution:
    """Decide which template id to grant.

    ``in_items_exact`` must be a case-sensitive hit on ``dune.items.template_id``.
    ``tail_match`` is the id returned by an ILIKE lookup on the recipe tail, or
    ``None``. Known-catalog entries may be granted even when no live row exists.
    """
    if in_items_exact:
        return GrantResolution(requested, None, "exact")
    if tail_match:
        return GrantResolution(
            tail_match,
            RECIPE_NOTE.format(requested=requested, resolved=tail_match),
            "recipe_tail",
        )
    if in_known:
        return GrantResolution(requested, None, "known_unconfirmed")
    return GrantResolution(requested, None, "unknown")
