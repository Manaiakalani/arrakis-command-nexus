"""Pure join/leave math for the connection tracker.

The asyncio loop, Discord, and DB writes stay in main.py for this pass.
Tests hit this module so a later move of the loop cannot silently invert
first-poll behaviour.
"""

from __future__ import annotations


def diff_online_players(
    previous_ids: set[str],
    current_ids: set[str],
    *,
    first_poll: bool,
) -> tuple[set[str], set[str], set[str]]:
    """Return (joined, left, next_previous).

    The first poll never emits joins — those players were already online
    before the dashboard started, and notifying would spam Discord.
    """
    if first_poll:
        return set(), set(), set(current_ids)
    joined = current_ids - previous_ids
    left = previous_ids - current_ids
    return joined, left, set(current_ids)
