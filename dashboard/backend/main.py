from __future__ import annotations

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
from routers import backups, config, discord, logs, maps, players, status, system
from services.backup_service import BackupService
from services.config_service import ConfigService
from services.discord_service import DiscordService
from services.docker_service import DockerService
from services.log_service import LogService
from services.metrics_service import MetricsService
from services.postgres_service import PostgresService

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
    metrics_service = MetricsService(interval_seconds=int(os.getenv("DUNE_METRICS_INTERVAL", "60")))
    backup_service = BackupService()
    discord_service = DiscordService()
    postgres_service = PostgresService()
    log_service = LogService(docker_service)

    app.state.docker_service = docker_service
    app.state.config_service = config_service
    app.state.metrics_service = metrics_service
    app.state.backup_service = backup_service
    app.state.discord_service = discord_service
    app.state.postgres_service = postgres_service
    app.state.log_service = log_service

    await docker_service.start()
    await postgres_service.start()
    await metrics_service.start()
    await discord_service.start()
    logger.info("Dune dashboard backend started")
    try:
        yield
    finally:
        await discord_service.stop()
        await metrics_service.stop()
        await postgres_service.close()
        await docker_service.close()
        await dispose_db()
        logger.info("Dune dashboard backend stopped")


app = FastAPI(title="Dune Awakening Dashboard API", version="1.0.0", lifespan=lifespan)

allowed_hosts = [host.strip() for host in os.getenv("DUNE_ADMIN_ALLOWED_HOSTS", "*").split(",") if host.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_hosts or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AdminTokenMiddleware)

app.include_router(status.router, prefix="/api")
app.include_router(maps.router, prefix="/api")
app.include_router(config.router, prefix="/api")
app.include_router(players.router, prefix="/api")
app.include_router(logs.router, prefix="/api")
app.include_router(system.router, prefix="/api")
app.include_router(backups.router, prefix="/api")
app.include_router(discord.router, prefix="/api")


@app.get("/api/ping")
async def ping() -> dict[str, str]:
    return {"status": "pong"}


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
