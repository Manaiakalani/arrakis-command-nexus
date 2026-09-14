"""Connection tracker: join/leave math plus the asyncio poll loop.

Tests hit `diff_online_players` so a later change cannot silently invert
first-poll behaviour. Discord and DB writes stay here with the loop.
"""

from __future__ import annotations

import asyncio
import logging


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


async def track_player_connections(postgres_service, discord_service=None) -> None:
    """Poll online players every 15s and log connect/disconnect events."""
    from db.database import SessionLocal
    from db.models import AuditLog, ConnectionLog

    tracker_log = logging.getLogger("player_tracker")
    tracker_log.info("Connection tracker started (discord_service=%s)", "enabled" if discord_service else "disabled")

    previous_ids: set[str] = set()
    known_players: dict[str, tuple[str, str]] = {}
    first_poll = True
    failures = 0
    while True:
        try:
            current_players = await postgres_service.get_online_players()
            current_ids = {p.steam_id for p in current_players}

            for p in current_players:
                pname = getattr(p, "name", None) or p.steam_id
                mname = getattr(p, "map_name", None) or "Unknown"
                known_players[p.steam_id] = (pname, mname)

            joined, left, next_ids = diff_online_players(previous_ids, current_ids, first_poll=first_poll)
            if first_poll:
                tracker_log.info("Initial poll: %d player(s) online", len(current_ids))
                first_poll = False
                previous_ids = next_ids
                await asyncio.sleep(15)
                continue

            if joined or left:
                tracker_log.info(
                    "Player change detected: +%d joined, -%d left (total: %d)",
                    len(joined), len(left), len(current_ids),
                )
                async with SessionLocal() as session:
                    for sid in joined:
                        pname, mname = known_players.get(sid, (sid, "Unknown"))
                        session.add(ConnectionLog(
                            steam_id=sid,
                            player_name=pname,
                            event="connect",
                            map_name=mname,
                        ))
                        session.add(AuditLog(
                            action="player_login",
                            details={"steam_id": sid, "player_name": pname, "map": mname},
                            performed_by="system",
                        ))
                        tracker_log.info("Player connected: %s (%s) on %s", pname, sid, mname)
                    for sid in left:
                        pname, mname = known_players.get(sid, (sid, "Unknown"))
                        session.add(ConnectionLog(
                            steam_id=sid,
                            player_name=pname,
                            event="disconnect",
                            map_name=mname,
                        ))
                        session.add(AuditLog(
                            action="player_logout",
                            details={"steam_id": sid, "player_name": pname, "map": mname},
                            performed_by="system",
                        ))
                        tracker_log.info("Player disconnected: %s (%s) from %s", pname, sid, mname)
                    await session.commit()

                if discord_service is not None:
                    for sid in joined:
                        pname, mname = known_players.get(sid, (sid, "Unknown"))
                        count = await discord_service.enqueue(
                            "player_join",
                            f"**{pname}** connected to **{mname}** ({len(current_ids)} online)",
                            title="Player Connected",
                        )
                        tracker_log.info("Discord join notification queued to %d webhook(s)", count)
                    for sid in left:
                        pname, mname = known_players.get(sid, (sid, "Unknown"))
                        count = await discord_service.enqueue(
                            "player_leave",
                            f"**{pname}** disconnected from **{mname}** ({len(current_ids)} online)",
                            title="Player Disconnected",
                        )
                        tracker_log.info("Discord leave notification queued to %d webhook(s)", count)

            previous_ids = next_ids
            for sid in left:
                known_players.pop(sid, None)
            failures = 0
        except Exception:  # noqa: BLE001
            logging.getLogger("player_tracker").warning(
                "Failed to track player connections", exc_info=True
            )
            failures += 1
            await asyncio.sleep(min(120, 15 * (2 ** min(failures, 4))))
            continue
        await asyncio.sleep(15)
