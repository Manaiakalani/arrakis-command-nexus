from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any

import docker
from docker.errors import DockerException, NotFound

from middleware.redaction import redact
from models.server import MapStatus, ServiceStatus

logger = logging.getLogger(__name__)


class DockerService:
    def __init__(self, base_url: str | None = None) -> None:
        default_base_url = "npipe:////./pipe/docker_engine" if os.name == "nt" else "unix:///var/run/docker.sock"
        self.base_url = base_url or os.getenv("DUNE_DOCKER_BASE_URL", default_base_url)
        self.compose_project = os.getenv("DUNE_COMPOSE_PROJECT", "dune-awakening")
        self.client: docker.DockerClient | None = None
        self.available = False
        self.role_patterns: dict[str, tuple[str, ...]] = {
            "db-init": ("db-init", "db_init"),
            "gateway": ("gateway",),
            "director": ("director",),
            "postgres": ("postgres", "database"),
            "rabbitmq": ("rabbit", "rmq"),
            "auth-shim": ("auth-shim", "auth_shim"),
            "text-router": ("text-router", "text_router"),
            "overmap": ("overmap",),
            "survival": ("survival", "sietch", "hagga", "deepdesert"),
            "dashboard": ("dashboard",),
        }
        self.critical_roles = {"gateway", "director", "postgres"}

    async def start(self) -> None:
        await asyncio.to_thread(self._connect)

    def _connect(self) -> None:
        try:
            self.client = docker.DockerClient(base_url=self.base_url)
            self.client.ping()
            self.available = True
        except DockerException as exc:
            logger.warning("Docker client unavailable: %s", exc)
            self.client = None
            self.available = False

    async def close(self) -> None:
        client = self.client
        self.client = None
        self.available = False
        if client is not None:
            await asyncio.to_thread(client.close)

    async def list_containers(self) -> list[ServiceStatus]:
        if not self.client:
            return []
        containers = await asyncio.to_thread(
            lambda: self.client.containers.list(
                all=True,
                filters={"label": f"com.docker.compose.project={self.compose_project}"},
            )
        )
        return [self._to_service_status(container) for container in containers]

    async def get_container_stats(self, name: str) -> dict[str, float | None]:
        container = await self._get_container(name)
        stats = await asyncio.to_thread(lambda: container.stats(stream=False))
        cpu_percent = self._calculate_cpu_percent(stats)
        memory_usage = float(stats.get("memory_stats", {}).get("usage", 0)) / (1024 * 1024)
        memory_limit = float(stats.get("memory_stats", {}).get("limit", 0)) / (1024 * 1024)
        return {
            "cpu_percent": cpu_percent,
            "memory_usage_mb": round(memory_usage, 2),
            "memory_limit_mb": round(memory_limit, 2) if memory_limit else None,
        }

    async def restart_container(self, name: str) -> dict[str, str]:
        container = await self._get_container(name)
        await asyncio.to_thread(container.restart)
        return {"status": "ok", "action": "restart", "container": container.name}

    async def stop_container(self, name: str) -> dict[str, str]:
        container = await self._get_container(name)
        await asyncio.to_thread(container.stop)
        return {"status": "ok", "action": "stop", "container": container.name}

    async def start_container(self, name: str) -> dict[str, str]:
        container = await self._get_container(name)
        await asyncio.to_thread(container.start)
        return {"status": "ok", "action": "start", "container": container.name}

    async def get_container_logs(self, name: str, tail: int = 100, follow: bool = False) -> list[str]:
        container = await self._get_container(name)
        raw_logs = await asyncio.to_thread(
            lambda: container.logs(tail=tail, timestamps=True, follow=follow)
        )
        if isinstance(raw_logs, bytes):
            return [redact(line) for line in raw_logs.decode("utf-8", errors="replace").splitlines() if line.strip()]
        return []

    def open_log_stream(self, name: str, tail: int = 100):
        if not self.client:
            raise RuntimeError("Docker client unavailable")
        container = self._get_container_sync(name)
        return container.logs(stream=True, follow=True, tail=tail, timestamps=True)

    async def get_readiness(self) -> dict[str, Any]:
        services = await self.list_containers()
        return self.evaluate_readiness(services)

    def evaluate_readiness(self, services: list[ServiceStatus]) -> dict[str, Any]:
        if not self.available:
            return {"status": "fail", "details": {"docker": "unavailable"}}

        details: dict[str, dict[str, str | None]] = {}
        overall = "ok"
        for service in services:
            role = self._map_role(service.name)
            details[service.name] = {"role": role, "status": service.status, "health": service.health}
            if role in self.critical_roles:
                if service.status != "running":
                    overall = "fail"
                elif service.health not in {None, "healthy"} and overall != "fail":
                    overall = "warn"

        if not services:
            overall = "warn"
        return {"status": overall, "details": details}

    async def list_map_statuses(self) -> list[MapStatus]:
        services = await self.list_containers()
        maps: list[MapStatus] = []
        for service in services:
            role = self._map_role(service.name)
            if role not in {"overmap", "survival"}:
                continue
            stats: dict[str, float | None] = {}
            try:
                stats = await self.get_container_stats(service.name)
            except Exception as exc:  # noqa: BLE001
                logger.debug("Could not collect stats for %s: %s", service.name, exc)
            maps.append(
                MapStatus(
                    name=service.name,
                    status=service.status,
                    player_count=0,
                    memory_usage_mb=stats.get("memory_usage_mb") if stats else None,
                    memory_limit_mb=stats.get("memory_limit_mb") if stats else None,
                    port=self._extract_primary_port(service.ports),
                    partition=role,
                )
            )
        return maps

    async def get_uptime_seconds(self) -> float | None:
        services = await self.list_containers()
        return self.calculate_uptime(services)

    def calculate_uptime(self, services: list[ServiceStatus]) -> float | None:
        running = [service for service in services if service.status == "running" and service.created]
        if not running:
            return None
        starts: list[datetime] = []
        for service in running:
            created = service.created
            try:
                starts.append(datetime.fromisoformat(created.replace("Z", "+00:00")))
            except ValueError:
                continue
        if not starts:
            return None
        return max((datetime.now(timezone.utc) - min(starts)).total_seconds(), 0.0)

    async def _get_container(self, name: str):
        return await asyncio.to_thread(self._get_container_sync, name)

    def _get_container_sync(self, name: str):
        if not self.client:
            raise RuntimeError("Docker client unavailable")
        try:
            return self.client.containers.get(name)
        except NotFound:
            candidates = self.client.containers.list(all=True, filters={"name": name})
            if candidates:
                return candidates[0]
            raise

    def _to_service_status(self, container) -> ServiceStatus:
        attrs = container.attrs or {}
        state = attrs.get("State", {})
        health = (state.get("Health") or {}).get("Status")
        ports = self._format_ports(attrs.get("NetworkSettings", {}).get("Ports", {}))
        status = "running" if container.status == "running" else "stopped"
        if container.status not in {"running", "exited", "created", "paused"}:
            status = "error"
        # Use image name from Config to avoid expensive per-container Image API call
        image_name = attrs.get("Config", {}).get("Image", container.short_id)
        return ServiceStatus(
            name=container.name,
            status=status,
            health=health,
            container_id=container.short_id,
            image=image_name,
            created=attrs.get("Created"),
            ports=ports,
        )

    def _map_role(self, name: str) -> str:
        lowered = name.lower()
        for role, patterns in self.role_patterns.items():
            if any(pattern in lowered for pattern in patterns):
                return role
        return "service"

    def _format_ports(self, ports: dict[str, Any]) -> list[str]:
        rendered: list[str] = []
        for container_port, bindings in ports.items():
            if not bindings:
                rendered.append(container_port)
                continue
            for binding in bindings:
                rendered.append(f"{binding.get('HostIp', '0.0.0.0')}:{binding.get('HostPort')}->{container_port}")
        return rendered

    def _extract_primary_port(self, ports: list[str]) -> int | None:
        for port in ports:
            try:
                left = port.split("->", maxsplit=1)[0]
                return int(left.rsplit(":", maxsplit=1)[-1])
            except (ValueError, IndexError):
                continue
        return None

    def _calculate_cpu_percent(self, stats: dict[str, Any]) -> float:
        cpu_stats = stats.get("cpu_stats", {})
        precpu_stats = stats.get("precpu_stats", {})
        total = cpu_stats.get("cpu_usage", {}).get("total_usage", 0) - precpu_stats.get("cpu_usage", {}).get("total_usage", 0)
        system = cpu_stats.get("system_cpu_usage", 0) - precpu_stats.get("system_cpu_usage", 0)
        online_cpus = cpu_stats.get("online_cpus") or len(cpu_stats.get("cpu_usage", {}).get("percpu_usage", []) or [1])
        if total <= 0 or system <= 0:
            return 0.0
        return round((total / system) * online_cpus * 100, 2)
