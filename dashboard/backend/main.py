from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from db.database import dispose_db, init_db
from middleware.auth import AdminTokenMiddleware
from middleware.redaction import redact
from routers import announce, backups, characters, chat_guard, config, discord, economy, logs, maps, players, settings, status, system, watchdog
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
from services.watchdog_service import WatchdogService

load_dotenv()


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact(record.msg)
        if record.args:
            record.args = tuple(redact(str(arg)) for arg in record.args)
        return True


logging.basicConfig(level=os.getenv("DUNE_LOG_LEVEL", "INFO").upper())
for handler in logging.getLogger().handlers:
    handler.addFilter(RedactingFilter())

logger = logging.getLogger(__name__)


def _frontend_dir() -> Path | None:
    candidate = Path(os.getenv("DUNE_ADMIN_FRONTEND_DIR", str(Path(__file__).resolve().parents[1] / "frontend" / "dist")))
    return candidate if candidate.exists() else None


@asynccontextmanager
async def lifespan(app: FastAPI):
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
    discord_service = DiscordService()
    postgres_service = PostgresService()
    character_service = CharacterService(postgres_service=postgres_service)
    economy_service = EconomyService(postgres_service=postgres_service)
    log_service = LogService(docker_service)
    chat_guard_service = ChatGuardService(docker_service=docker_service)
    watchdog_service = WatchdogService(docker_service, discord_service)

    app.state.docker_service = docker_service
    app.state.config_service = config_service
    app.state.metrics_service = metrics_service
    app.state.backup_service = backup_service
    app.state.backup_scheduler = backup_scheduler
    app.state.announce_service = announce_service
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
        watchdog_service.start(),
        economy_service.start(),
        chat_guard_service.start(),
    )
    logger.info("Dune dashboard backend started")

    # Security warnings for weak defaults
    admin_token = os.getenv("DUNE_ADMIN_TOKEN", "")
    if not admin_token:
        logger.warning("SECURITY: DUNE_ADMIN_TOKEN is not set — API mutations are unprotected")
    elif admin_token.startswith("change-me"):
        logger.warning("SECURITY: DUNE_ADMIN_TOKEN is using a default value — change it for production")
    pg_pw = os.getenv("POSTGRES_DUNE_PASSWORD", "")
    if pg_pw.startswith("change-me"):
        logger.warning("SECURITY: POSTGRES_DUNE_PASSWORD is using a default value — change it for production")

    try:
        yield
    finally:
        await chat_guard_service.stop()
        await economy_service.stop()
        await watchdog_service.stop()
        await backup_scheduler.stop()
        await discord_service.stop()
        await metrics_service.stop()
        await postgres_service.close()
        await docker_service.close()
        await dispose_db()
        logger.info("Dune dashboard backend stopped")


app = FastAPI(title="Dune Awakening Dashboard API", version="1.0.0", lifespan=lifespan)

allowed_hosts_raw = os.getenv("DUNE_ADMIN_ALLOWED_HOSTS", "").strip()
allowed_hosts = [host.strip() for host in allowed_hosts_raw.split(",") if host.strip()] if allowed_hosts_raw else []
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_hosts or ["http://dashboard-frontend:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "X-Admin-Token"],
)
app.add_middleware(AdminTokenMiddleware)

app.include_router(status.router, prefix="/api")
app.include_router(announce.router, prefix="/api")
app.include_router(maps.router, prefix="/api")
app.include_router(config.router, prefix="/api")
app.include_router(players.router, prefix="/api")
app.include_router(logs.router, prefix="/api")
app.include_router(system.router, prefix="/api")
app.include_router(backups.router, prefix="/api")
app.include_router(discord.router, prefix="/api")
app.include_router(watchdog.router, prefix="/api")
app.include_router(economy.router, prefix="/api")
app.include_router(characters.router, prefix="/api")
app.include_router(chat_guard.router, prefix="/api")
app.include_router(settings.router, prefix="/api")


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
