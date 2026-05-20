from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from models.backup import BackupEntry

logger = logging.getLogger(__name__)


class BackupService:
    def __init__(self, backup_dir: str | None = None) -> None:
        base_path = Path(__file__).resolve().parents[1]
        self.backup_dir = Path(backup_dir or os.getenv("BACKUP_DIR", "/backups"))
        self.backup_script = Path(os.getenv("DUNE_BACKUP_SCRIPT", str(base_path / "scripts" / "backup.sh")))
        self.restore_script = Path(os.getenv("DUNE_RESTORE_SCRIPT", str(base_path / "scripts" / "restore.sh")))

    async def list_backups(self) -> list[BackupEntry]:
        if not self.backup_dir.exists():
            return []

        entries: list[BackupEntry] = []
        for path in sorted(self.backup_dir.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True):
            if path.name.endswith(".meta"):
                continue
            meta = self._read_metadata(path)
            stat = path.stat()
            entries.append(
                BackupEntry(
                    id=path.stem,
                    filename=path.name,
                    path=str(path),
                    size_bytes=stat.st_size if path.is_file() else None,
                    created_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                    metadata=meta,
                )
            )
        return entries

    async def trigger_backup(self) -> dict[str, str | int]:
        if not self.backup_script.exists():
            raise FileNotFoundError(f"Backup script not found: {self.backup_script}")
        process = await asyncio.create_subprocess_exec(
            "sh",
            str(self.backup_script),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        return {
            "returncode": process.returncode,
            "stdout": stdout.decode("utf-8", errors="replace").strip(),
            "stderr": stderr.decode("utf-8", errors="replace").strip(),
        }

    async def trigger_restore(self, backup_id: str) -> dict[str, str | int]:
        target = self._find_backup(backup_id)
        if not self.restore_script.exists():
            raise FileNotFoundError(f"Restore script not found: {self.restore_script}")
        process = await asyncio.create_subprocess_exec(
            "sh",
            str(self.restore_script),
            str(target),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        return {
            "returncode": process.returncode,
            "stdout": stdout.decode("utf-8", errors="replace").strip(),
            "stderr": stderr.decode("utf-8", errors="replace").strip(),
        }

    async def delete_backup(self, backup_id: str) -> None:
        target = self._find_backup(backup_id)
        if target.is_dir():
            await asyncio.to_thread(shutil.rmtree, target)
        else:
            await asyncio.to_thread(target.unlink)
        meta = target.with_suffix(target.suffix + ".meta")
        if meta.exists():
            await asyncio.to_thread(meta.unlink)

    def _find_backup(self, backup_id: str) -> Path:
        if not self.backup_dir.exists():
            raise FileNotFoundError("Backup directory does not exist.")
        for entry in self.backup_dir.iterdir():
            if entry.name.endswith(".meta"):
                continue
            if entry.stem == backup_id or entry.name == backup_id:
                return entry
        raise FileNotFoundError(f"Backup not found: {backup_id}")

    def _read_metadata(self, backup_path: Path) -> dict[str, str]:
        candidates = [backup_path.with_suffix(backup_path.suffix + ".meta"), backup_path.with_name(f"{backup_path.stem}.meta")]
        for meta_path in candidates:
            if not meta_path.exists():
                continue
            text = meta_path.read_text(encoding="utf-8", errors="replace").strip()
            if not text:
                return {}
            try:
                data = json.loads(text)
                return {str(key): str(value) for key, value in data.items()}
            except json.JSONDecodeError:
                metadata: dict[str, str] = {}
                for line in text.splitlines():
                    if "=" in line:
                        key, value = line.split("=", maxsplit=1)
                        metadata[key.strip()] = value.strip()
                return metadata
        return {}
