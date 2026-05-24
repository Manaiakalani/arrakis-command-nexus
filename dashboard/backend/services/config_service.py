from __future__ import annotations

import asyncio
import configparser
import hashlib
import logging
import os
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from db.models import ConfigBackup
from models.config import ConfigField, ConfigFile, ConfigUpdate

logger = logging.getLogger(__name__)


class ConfigService:
    def __init__(self, config_dir: str | None = None) -> None:
        self.config_dir = Path(config_dir or os.getenv("DUNE_CONFIG_DIR", "/config"))
        self.allowed_files = {
            "UserGame.ini",
            "UserEngine.ini",
            "director.ini",
            "gateway.ini",
        }
        self.field_definitions: dict[str, dict[str, ConfigField]] = {
            "UserGame.ini": {
                "ServerName": ConfigField(
                    key="ServerName",
                    type="string",
                    description="Public server name shown in browser listings.",
                    default_value="Dune Awakening Server",
                ),
                "MaxPlayers": ConfigField(
                    key="MaxPlayers",
                    type="int",
                    description="Maximum concurrent connected players.",
                    default_value="40",
                ),
            },
            "gateway.ini": {
                "ListenPort": ConfigField(
                    key="ListenPort",
                    type="int",
                    description="Gateway listener port.",
                    default_value="7777",
                ),
            },
            "director.ini": {
                "LogLevel": ConfigField(
                    key="LogLevel",
                    type="string",
                    description="Director logging verbosity.",
                    default_value="INFO",
                ),
            },
        }
        self._baseline_hashes: dict[str, str] = {}
        self._drift_status: dict[str, dict] = {}

    async def list_configs(self) -> list[str]:
        return await asyncio.to_thread(self.list_configs_sync)

    def list_configs_sync(self) -> list[str]:
        if not self.config_dir.exists():
            return []
        files = sorted(path.name for path in self.config_dir.iterdir() if path.is_file())
        return [name for name in files if name in self.allowed_files]

    def _compute_hash(self, filepath: Path) -> str:
        """Compute SHA256 hash of a config file."""
        if not filepath.exists():
            return ""
        return hashlib.sha256(filepath.read_bytes()).hexdigest()[:16]

    def snapshot_baseline(self, filename: str) -> None:
        """Record the current file hash as the baseline."""
        self._validate_filename(filename)
        filepath = self.config_dir / filename
        current_hash = self._compute_hash(filepath)
        self._baseline_hashes[filename] = current_hash
        self._drift_status[filename] = {
            "drifted": False,
            "baselineHash": current_hash,
            "currentHash": current_hash,
            "detectedAt": None,
        }

    def check_drift(self, filename: str) -> dict:
        """Check if a config file has drifted from its baseline."""
        self._validate_filename(filename)
        filepath = self.config_dir / filename
        current_hash = self._compute_hash(filepath)
        baseline_hash = self._baseline_hashes.get(filename, "")

        if not baseline_hash:
            self.snapshot_baseline(filename)
            return self._drift_status[filename]

        drifted = current_hash != baseline_hash
        self._drift_status[filename] = {
            "drifted": drifted,
            "baselineHash": baseline_hash,
            "currentHash": current_hash,
            "detectedAt": datetime.now(timezone.utc).isoformat() if drifted else None,
        }
        return self._drift_status[filename]

    def check_all_drift(self) -> dict[str, dict]:
        """Check drift for all known config files."""
        return {filename: self.check_drift(filename) for filename in self.list_configs_sync()}

    def reset_baseline(self, filename: str) -> None:
        """Accept current state as the new baseline."""
        self.snapshot_baseline(filename)

    async def read_config(self, filename: str) -> ConfigFile:
        path = self._resolve_file(filename)
        parser = await asyncio.to_thread(self._load_parser, path)
        sections: dict[str, dict[str, str]] = {
            section: {key: value for key, value in parser.items(section)}
            for section in parser.sections()
        }
        return ConfigFile(filename=filename, sections=sections)

    async def update_config(
        self,
        filename: str,
        update: ConfigUpdate,
        session: AsyncSession,
    ) -> ConfigFile:
        if update.filename != filename:
            raise ValueError("Filename in request body must match route filename.")

        path = self._resolve_file(filename)
        parser = await asyncio.to_thread(self._load_parser, path)
        if not parser.has_section(update.section):
            parser.add_section(update.section)

        normalized_value = self._validate_value(filename, update.key, update.value)
        current = await self.read_config(filename)
        session.add(
            ConfigBackup(
                filename=filename,
                config_type=Path(filename).stem,
                content=current.model_dump()["sections"],
            )
        )
        await session.commit()

        parser.set(update.section, update.key, normalized_value)
        await asyncio.to_thread(self._write_parser, path, parser)
        logger.info("Updated config %s [%s] %s", filename, update.section, update.key)
        return await self.read_config(filename)

    def get_field_definitions(self, filename: str) -> dict[str, ConfigField]:
        return self.field_definitions.get(filename, {})

    def _validate_filename(self, filename: str) -> None:
        if filename not in self.allowed_files:
            raise FileNotFoundError(f"Unsupported config file: {filename}")

    def _resolve_file(self, filename: str) -> Path:
        self._validate_filename(filename)
        path = self.config_dir / filename
        if not path.exists():
            raise FileNotFoundError(f"Config file not found: {filename}")
        resolved_path = path.resolve()
        try:
            resolved_path.relative_to(self.config_dir.resolve())
        except ValueError as exc:
            raise FileNotFoundError(f"Config file not found: {filename}") from exc
        return resolved_path

    def _load_parser(self, path: Path) -> configparser.ConfigParser:
        parser = configparser.ConfigParser()
        parser.optionxform = str
        parser.read(path, encoding="utf-8")
        return parser

    def _write_parser(self, path: Path, parser: configparser.ConfigParser) -> None:
        buffer = StringIO()
        parser.write(buffer)
        path.write_text(buffer.getvalue(), encoding="utf-8")

    def _validate_value(self, filename: str, key: str, value: str) -> str:
        definition = self.get_field_definitions(filename).get(key)
        if not definition:
            return value

        try:
            if definition.type == "bool":
                normalized = value.strip().lower()
                if normalized not in {"1", "0", "true", "false", "yes", "no", "on", "off"}:
                    raise ValueError("Expected a boolean value.")
                return "True" if normalized in {"1", "true", "yes", "on"} else "False"
            if definition.type == "int":
                return str(int(value))
            if definition.type == "float":
                return str(float(value))
            return str(value)
        except ValueError as exc:
            raise ValueError(f"Invalid value for {key}: {exc}") from exc
