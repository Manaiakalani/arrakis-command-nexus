from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from models.backup import BackupEntry

logger = logging.getLogger(__name__)

_SCOPE_ALIASES = {
    "full": "full",
    "configs": "config",
    "config": "config",
    "database": "db",
    "db": "db",
    "save-data": "full",
}


class BackupService:
    def __init__(self, backup_dir: str | None = None) -> None:
        current_file = Path(__file__).resolve()
        script_root = next((parent for parent in current_file.parents if (parent / "scripts" / "backup.sh").exists()), current_file.parents[1])
        self.backup_dir = Path(backup_dir or os.getenv("BACKUP_DIR", "/backups"))
        self.backup_script = Path(os.getenv("DUNE_BACKUP_SCRIPT", str(script_root / "scripts" / "backup.sh")))
        self.restore_script = Path(os.getenv("DUNE_RESTORE_SCRIPT", str(script_root / "scripts" / "restore.sh")))

    async def list_backups(self) -> list[BackupEntry]:
        if not self.backup_dir.exists():
            return []

        entries: list[BackupEntry] = []
        try:
            candidates = sorted(self.backup_dir.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True)
        except (FileNotFoundError, OSError):
            candidates = []
        for candidate in candidates:
            if candidate.name.endswith(".meta"):
                continue
            try:
                path = self._resolve_backup_path(candidate)
            except FileNotFoundError:
                logger.warning("Skipping backup outside backup directory: %s", candidate)
                continue
            try:
                meta = self._read_metadata(path)
                stat = path.stat()
            except (FileNotFoundError, OSError):
                logger.warning("Backup file disappeared during listing: %s", path)
                continue
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

    async def create_backup(self, scope: str = "full") -> BackupEntry:
        normalized_scope = self._normalize_scope(scope)
        before_names = {entry.filename for entry in await self.list_backups()}
        result = await self._run_backup_command(normalized_scope)
        self._log_process_output("backup", result)
        if int(result["returncode"]) != 0:
            raise RuntimeError(result.get("stderr") or result.get("stdout") or "Backup command failed.")

        backups = await self.list_backups()
        created = next((entry for entry in backups if entry.filename not in before_names), None)
        if created is None:
            created = backups[0] if backups else BackupEntry(
                id=f"{normalized_scope}-{int(datetime.now(timezone.utc).timestamp())}",
                filename=f"{normalized_scope}-backup",
                path=str(self.backup_dir),
                created_at=datetime.now(timezone.utc),
                metadata={"scope": normalized_scope},
            )
        logger.info("Created backup %s for scope %s", created.filename, normalized_scope)
        return created

    async def trigger_backup(self, scope: str = "full") -> dict[str, str | int]:
        normalized_scope = self._normalize_scope(scope)
        result = await self._run_backup_command(normalized_scope)
        self._log_process_output("backup", result)
        return result

    async def trigger_restore(self, backup_id: str) -> dict[str, str | int]:
        target = self._find_backup(backup_id)
        if target.stat().st_size == 0:
            raise ValueError(f"Backup file is empty and cannot be restored: {target.name}")
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
        result = {
            "returncode": process.returncode,
            "stdout": stdout.decode("utf-8", errors="replace").strip(),
            "stderr": stderr.decode("utf-8", errors="replace").strip(),
        }
        self._log_process_output("restore", result)
        return result

    async def delete_backup(self, backup_id: str) -> None:
        target = self._find_backup(backup_id)
        deleted_meta = await self._delete_backup_artifact(target)
        logger.info("Deleted backup %s (metadata_removed=%s)", backup_id, len(deleted_meta))

    async def prune_old_backups(self, retention_days: int) -> int:
        if retention_days < 0:
            raise ValueError("retention_days must be 0 or greater")
        if not self.backup_dir.exists():
            logger.info("Skipping backup prune because directory %s does not exist", self.backup_dir)
            return 0

        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        stale_backups = [
            path
            for path in self.backup_dir.iterdir()
            if not path.name.endswith(".meta") and datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc) < cutoff
        ]

        deleted_count = 0
        for target in stale_backups:
            try:
                await self._delete_backup_artifact(target)
            except FileNotFoundError:
                logger.warning("Skipping prune for backup outside backup directory: %s", target)
                continue
            deleted_count += 1
            logger.info("Pruned expired backup %s", target.name)

        deleted_meta = 0
        for meta_path in self.backup_dir.iterdir():
            if not meta_path.name.endswith(".meta"):
                continue
            if datetime.fromtimestamp(meta_path.stat().st_mtime, tz=timezone.utc) >= cutoff:
                continue
            if self._metadata_referenced(meta_path):
                continue
            await asyncio.to_thread(meta_path.unlink)
            deleted_meta += 1
            logger.info("Pruned orphaned backup metadata %s", meta_path.name)

        logger.info(
            "Finished pruning backups older than %s day(s): deleted_backups=%s deleted_meta=%s",
            retention_days,
            deleted_count,
            deleted_meta,
        )
        return deleted_count

    def _find_backup(self, backup_id: str) -> Path:
        if not self.backup_dir.exists():
            raise FileNotFoundError("Backup directory does not exist.")
        for entry in self.backup_dir.iterdir():
            if entry.name.endswith(".meta"):
                continue
            if entry.stem == backup_id or entry.name == backup_id:
                return self._resolve_backup_path(entry)
        raise FileNotFoundError(f"Backup not found: {backup_id}")

    def _resolve_backup_path(self, path: Path) -> Path:
        resolved_dir = self.backup_dir.resolve()
        resolved_path = path.resolve()
        try:
            resolved_path.relative_to(resolved_dir)
        except ValueError as exc:
            raise FileNotFoundError(f"Backup not found: {path.name}") from exc
        return resolved_path

    def _read_metadata(self, backup_path: Path) -> dict[str, str]:
        for meta_path in self._metadata_candidates(backup_path):
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

    async def _run_backup_command(self, scope: str) -> dict[str, str | int]:
        if not self.backup_script.exists():
            raise FileNotFoundError(f"Backup script not found: {self.backup_script}")
        process = await asyncio.create_subprocess_exec(
            "sh",
            str(self.backup_script),
            "--scope",
            scope,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        return {
            "returncode": process.returncode,
            "stdout": stdout.decode("utf-8", errors="replace").strip(),
            "stderr": stderr.decode("utf-8", errors="replace").strip(),
        }

    async def _delete_backup_artifact(self, target: Path) -> list[Path]:
        target = self._resolve_backup_path(target)
        metadata_paths = self._metadata_candidates(target)
        if target.is_dir():
            await asyncio.to_thread(shutil.rmtree, target)
        else:
            await asyncio.to_thread(target.unlink)

        deleted_meta: list[Path] = []
        for meta_path in metadata_paths:
            if not meta_path.exists() or self._metadata_referenced(meta_path):
                continue
            await asyncio.to_thread(meta_path.unlink)
            deleted_meta.append(meta_path)
        return deleted_meta

    def _metadata_candidates(self, backup_path: Path) -> list[Path]:
        candidates = {
            backup_path.with_suffix(backup_path.suffix + ".meta"),
            backup_path.with_name(f"{backup_path.stem}.meta"),
        }
        stem = backup_path.name[:-7] if backup_path.name.endswith(".tar.gz") else backup_path.stem
        if stem.startswith("dune-") and "__" in stem:
            prefix, timestamp = stem.split("__", maxsplit=1)
            scope = prefix.split("-")[-1]
            candidates.add(backup_path.with_name(f"dune-{scope}__{timestamp}.meta"))
        return sorted(candidates)

    def _metadata_referenced(self, meta_path: Path) -> bool:
        if not self.backup_dir.exists():
            return False
        for entry in self.backup_dir.iterdir():
            if entry.name.endswith(".meta"):
                continue
            if meta_path in self._metadata_candidates(entry):
                return True
        return False

    def _normalize_scope(self, scope: str) -> str:
        normalized = _SCOPE_ALIASES.get(scope.strip().lower())
        if not normalized:
            raise ValueError(f"Unsupported backup scope: {scope}")
        return normalized

    def _log_process_output(self, action: str, result: dict[str, str | int]) -> None:
        stdout = str(result.get("stdout", "") or "").strip()
        stderr = str(result.get("stderr", "") or "").strip()
        if stdout:
            logger.info("Backup %s stdout: %s", action, stdout)
        if stderr:
            logger.warning("Backup %s stderr: %s", action, stderr)
