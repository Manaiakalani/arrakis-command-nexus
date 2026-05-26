from __future__ import annotations

import asyncio
import random

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(tags=["announcements"])

# Dune-themed wisdom mixed with gen-z energy
WISDOM_POOL: list[str] = [
    "Fear is the mind-killer, bestie. Literally just breathe through it.",
    "The spice must flow and so must your hustle. No cap.",
    "He who controls the spice controls the universe. Main character energy fr.",
    "A mind commands the body and it obeys. A mind commands itself and meets resistance. That's lowkey deep.",
    "The mystery of life isn't a problem to solve, but a reality to experience. Vibe check: passed.",
    "Desert power is giving big slay energy right now.",
    "Do not be trapped by the need to achieve anything. This way, you achieve everything. Based advice.",
    "God created Arrakis to train the faithful. It hits different out here.",
    "The sleeper has awakened. Rise and grind, fam.",
    "There is no escape. We pay for the violence of our ancestors. Real talk, no cap.",
    "Survival is the ability to swim in strange water. Adapt or get ratio'd.",
    "Without change, something sleeps inside us and seldom awakens. Glow up era, let's go.",
    "Deep in the human unconscious is a need for a logical universe. Too bad Arrakis chose chaos. It's giving unhinged.",
    "Polish comes from the cities, wisdom from the desert. Touch sand, bestie.",
    "The concept of progress acts as a protective mechanism. Copium? Maybe. But we move.",
    "Arrakis teaches the attitude of the knife. Slay or be slain. Periodt.",
    "When you see spice for the first time, you'll understand the vibe. It's literally bussin.",
    "Walk without rhythm, and you won't attract the worm. Stealth mode: activated.",
    "The Fremen were not combatants in the ordinary sense. They were built different. No debate.",
    "Beginnings are such delicate times. Handle with care, or it's giving disaster.",
    "A process cannot be understood by stopping it. You have to move with the flow. Slay the process.",
    "Knowing where the trap is, that's the first step in evading it. Awareness? Immaculate.",
    "Power over spice is power over all. That's literally the whole vibe.",
    "The willow submits to the wind and prospers until one day it is many willows. Growth mindset unlocked.",
    "Respect the maker. The sandworm doesn't care about your hot takes.",
    "Water discipline is a flex on Arrakis. Every drop is a W.",
    "Don't underestimate the power of a stillsuit. It's sustainable fashion, bestie.",
    "In the desert, you learn what truly matters. The rest is just noise. Mute it.",
    "The Bene Gesserit say: existence is random, but consciousness is not. That's giving philosopher energy.",
    "May your water of life be plentiful and your enemies be mid.",
]


class AnnouncementRequest(BaseModel):
    message: str
    sender: str | None = None


class PreRestartRequest(BaseModel):
    minutes: int = 5


@router.post("/announce")
async def send_announcement(payload: AnnouncementRequest, request: Request) -> dict[str, bool | str]:
    service = request.app.state.announce_service
    success = await asyncio.to_thread(service.send_announcement, payload.message, payload.sender)
    return {"success": success, "message": "Announcement sent" if success else "Failed to send"}


@router.post("/announce/pre-restart")
async def send_pre_restart(payload: PreRestartRequest, request: Request) -> dict[str, bool]:
    service = request.app.state.announce_service
    success = await asyncio.to_thread(service.send_pre_restart_warning, payload.minutes)
    return {"success": success}


@router.get("/announce/history")
async def get_history(request: Request) -> list[dict]:
    service = request.app.state.announce_service
    return list(reversed(service.history))


class WisdomSetupRequest(BaseModel):
    interval_minutes: int = 45
    sender: str = "Muad'Dib"
    enabled: bool = True


@router.get("/announce/wisdom/pool")
async def get_wisdom_pool() -> dict:
    """Return the full pool of wisdom quotes."""
    return {"quotes": WISDOM_POOL, "total": len(WISDOM_POOL)}


@router.post("/announce/wisdom/setup")
async def setup_wisdom_scheduler(payload: WisdomSetupRequest, request: Request) -> dict:
    """Create a recurring wisdom announcement that cycles through quotes."""
    scheduler = request.app.state.announce_scheduler
    # Build a shuffled message that includes a random rotation marker
    # so each fire picks a different quote
    shuffled = list(WISDOM_POOL)
    random.shuffle(shuffled)
    # We store the pool and index in the scheduler as a special "wisdom" type
    # For simplicity, create one recurring announcement with __WISDOM__ marker
    announcement = await scheduler.create_announcement(
        message="__WISDOM__",
        sender=payload.sender,
        interval_minutes=max(1, payload.interval_minutes),
        enabled=payload.enabled,
    )
    return {"success": True, "announcement": announcement}


@router.post("/announce/wisdom/send")
async def send_random_wisdom(request: Request) -> dict:
    """Send a single random wisdom quote immediately."""
    service = request.app.state.announce_service
    quote = random.choice(WISDOM_POOL)
    success = await asyncio.to_thread(service.send_announcement, quote, "Muad'Dib")
    return {"success": success, "quote": quote}
