from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from db.database import dispose_db, init_db
from middleware.auth import AdminTokenMiddleware, verify_admin_token
from middleware.rate_limit import RateLimitMiddleware
from middleware.redaction import redact
from middleware.request_logging import RequestLoggingMiddleware
from middleware.security_headers import SecurityHeadersMiddleware
from routers import announce, audit, backups, characters, chat_guard, config, discord, economy, logs, maps, players, restart_schedule, scheduled_announce, settings, status, system, updates, watchdog
from services.announce_scheduler import AnnounceScheduler
from services.announce_service import AnnounceService
from services.backup_scheduler import BackupScheduler
from services.backup_service import BackupService
from services.character_service import CharacterService
from services.chat_guard_service import ChatGuardService
from services.config_service import ConfigService
from services.discord_service import DiscordService
from services.docker_service import DockerService
from services.economy_service import EconomyService
from services.log_service import LogService
from services.metrics_service import MetricsService
from services.postgres_service import PostgresService
from services.restart_scheduler import RestartScheduler
from services.watchdog_service import WatchdogService

load_dotenv()


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact(record.msg)
        if record.args:
            record.args = tuple(
                redact(arg) if isinstance(arg, str) else arg
                for arg in record.args
            )
        return True


logging.basicConfig(level=os.getenv("DUNE_LOG_LEVEL", "INFO").upper())
for handler in logging.getLogger().handlers:
    handler.addFilter(RedactingFilter())

logger = logging.getLogger(__name__)


def _cors_origins() -> list[str]:
    allowed_hosts_raw = os.getenv("DUNE_ADMIN_ALLOWED_HOSTS", "").strip()
    if not allowed_hosts_raw:
        return ["http://dashboard-frontend:3000"]

    origins: list[str] = []
    seen: set[str] = set()
    for raw_host in allowed_hosts_raw.split(","):
        candidate = raw_host.strip().rstrip("/")
        if not candidate:
            continue
        if candidate == "*":
            logger.warning("Ignoring insecure wildcard entry in DUNE_ADMIN_ALLOWED_HOSTS")
            continue
        options = [candidate] if "://" in candidate else [f"http://{candidate}", f"https://{candidate}"]
        for origin in options:
            if origin in seen:
                continue
            seen.add(origin)
            origins.append(origin)

    return origins or ["http://dashboard-frontend:3000"]


def _frontend_dir() -> Path | None:
    candidate = Path(os.getenv("DUNE_ADMIN_FRONTEND_DIR", str(Path(__file__).resolve().parents[1] / "frontend" / "dist")))
    return candidate if candidate.exists() else None


async def _track_player_connections(postgres_service: PostgresService, discord_service=None) -> None:
    """Poll online players every 15s and log connect/disconnect events."""
    from db.database import SessionLocal
    from db.models import AuditLog, ConnectionLog

    tracker_log = logging.getLogger("player_tracker")
    tracker_log.info("Connection tracker started (discord_service=%s)", "enabled" if discord_service else "disabled")

    previous_ids: set[str] = set()
    # Cache steam_id -> (name, map) so disconnect messages show player names
    known_players: dict[str, tuple[str, str]] = {}
    first_poll = True
    while True:
        try:
            current_players = await postgres_service.get_online_players()
            current_ids = {p.steam_id for p in current_players}

            # Always update the name cache with current data
            for p in current_players:
                pname = getattr(p, "name", None) or p.steam_id
                mname = getattr(p, "map_name", None) or "Unknown"
                known_players[p.steam_id] = (pname, mname)

            if first_poll:
                tracker_log.info("Initial poll: %d player(s) online", len(current_ids))
                first_poll = False
                previous_ids = current_ids
                await asyncio.sleep(15)
                continue

            joined = current_ids - previous_ids
            left = previous_ids - current_ids

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

                # Send Discord notifications outside the DB session
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

            previous_ids = current_ids
        except Exception:  # noqa: BLE001
            logging.getLogger("player_tracker").warning(
                "Failed to track player connections", exc_info=True
            )
            # Exponential backoff on repeated failures (cap at 120s)
            await asyncio.sleep(min(60, 15 * 2))
            continue
        await asyncio.sleep(15)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail fast if placeholder secrets are still set
    admin_token = os.getenv("DUNE_ADMIN_TOKEN", "")
    if admin_token.startswith("change-me"):
        logging.getLogger("dune.startup").critical(
            "DUNE_ADMIN_TOKEN is still set to a placeholder value. "
            "Generate a real token: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
        )
        raise SystemExit(1)

    await init_db()

    docker_service = DockerService()
    config_service = ConfigService()
    metrics_service = MetricsService(
        interval_seconds=int(os.getenv("DUNE_METRICS_INTERVAL", "60")),
        retention=int(os.getenv("DUNE_METRICS_RETENTION", "43200")),
    )
    backup_service = BackupService()
    backup_scheduler = BackupScheduler(backup_service)
    announce_service = AnnounceService()
    announce_scheduler = AnnounceScheduler(announce_service)
    discord_service = DiscordService()
    postgres_service = PostgresService()
    character_service = CharacterService(postgres_service=postgres_service)
    economy_service = EconomyService(postgres_service=postgres_service)
    log_service = LogService(docker_service)
    chat_guard_service = ChatGuardService(docker_service=docker_service)
    watchdog_service = WatchdogService(docker_service, discord_service)
    restart_scheduler = RestartScheduler(announce_service, backup_service, docker_service, watchdog_service)

    app.state.docker_service = docker_service
    app.state.config_service = config_service
    app.state.metrics_service = metrics_service
    app.state.backup_service = backup_service
    app.state.backup_scheduler = backup_scheduler
    app.state.announce_service = announce_service
    app.state.announce_scheduler = announce_scheduler
    app.state.restart_scheduler = restart_scheduler
    app.state.discord_service = discord_service
    app.state.postgres_service = postgres_service
    app.state.character_service = character_service
    app.state.economy_service = economy_service
    app.state.log_service = log_service
    app.state.chat_guard_service = chat_guard_service
    app.state.watchdog_service = watchdog_service

    # Start independent services in parallel for faster boot
    await asyncio.gather(
        docker_service.start(),
        postgres_service.start(),
        discord_service.start(),
    )
    # These depend on docker/postgres being ready
    await asyncio.gather(
        metrics_service.start(),
        backup_scheduler.start(),
        announce_scheduler.start(),
        restart_scheduler.start(),
        watchdog_service.start(),
        economy_service.start(),
        chat_guard_service.start(),
    )
    logger.info("Dune dashboard backend started")

    # Background task: track player connections
    connection_tracker_task = asyncio.create_task(
        _track_player_connections(postgres_service, discord_service), name="connection-tracker"
    )

    # Security warnings for weak defaults
    admin_token = os.getenv("DUNE_ADMIN_TOKEN", "")
    if not admin_token:
        logger.critical("SECURITY: DUNE_ADMIN_TOKEN is not set — authenticated API actions will be rejected")
    elif admin_token.startswith("change-me"):
        if os.getenv("DUNE_ENV", "production").lower() in ("dev", "development"):
            logger.warning("SECURITY: DUNE_ADMIN_TOKEN uses a default value (allowed in dev mode)")
        else:
            logger.critical(
                "SECURITY: DUNE_ADMIN_TOKEN uses a default 'change-me' value. "
                "Set a strong token or export DUNE_ENV=development to suppress this check."
            )
    pg_pw = os.getenv("POSTGRES_DUNE_PASSWORD", "")
    if pg_pw.startswith("change-me"):
        logger.warning("SECURITY: POSTGRES_DUNE_PASSWORD is using a default value — change it for production")

    try:
        yield
    finally:
        connection_tracker_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await connection_tracker_task
        await chat_guard_service.stop()
        await economy_service.stop()
        await watchdog_service.stop()
        await restart_scheduler.stop()
        await backup_scheduler.stop()
        await announce_scheduler.stop()
        await discord_service.stop()
        await metrics_service.stop()
        await postgres_service.close()
        await docker_service.close()
        await dispose_db()
        logger.info("Dune dashboard backend stopped")


app = FastAPI(title="Dune Awakening Dashboard API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "X-Admin-Token"],
)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(AdminTokenMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(RequestLoggingMiddleware)

_SECURE_API_DEPENDENCIES = [Depends(verify_admin_token)]

app.include_router(status.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(announce.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(scheduled_announce.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(maps.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(config.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(players.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(logs.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(system.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(backups.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(restart_schedule.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(discord.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(watchdog.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(economy.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(characters.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(chat_guard.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(settings.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(audit.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)
app.include_router(updates.router, prefix="/api", dependencies=_SECURE_API_DEPENDENCIES)


@app.get("/api/ping")
async def ping() -> dict[str, str]:
    return {"status": "pong"}


@app.get("/health")
async def root_health() -> dict[str, str]:
    return {"status": "ok"}


frontend_dir = _frontend_dir()
if frontend_dir is not None:

    @app.get("/{full_path:path}", include_in_schema=False)
    async def frontend_fallback(full_path: str) -> FileResponse:
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="Not found")
        requested = (frontend_dir / full_path).resolve() if full_path else frontend_dir / "index.html"
        try:
            requested.relative_to(frontend_dir.resolve())
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="Not found") from exc
        if requested.exists() and requested.is_file():
            return FileResponse(requested)
        index_file = frontend_dir / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        raise HTTPException(status_code=404, detail="Frontend not available")
