"""Helpers for reading and writing individual keys in the stack's ``.env`` file.

The dashboard edits a small number of operator-facing values (server name,
broadcast address, login password) that the game-server containers read from
``.env`` at (re)create time. Centralising the file access here keeps a single
source of truth and avoids each router re-implementing the parsing.

All writes are serialised through ``env_file_lock`` (a :class:`threading.Lock`)
so that concurrent requests from different routers never interleave file I/O.
Callers running in an async context should wrap calls with
``await asyncio.to_thread(write_env_var, …)``.
"""

from __future__ import annotations

import os
import re
import threading

ENV_PATH = os.getenv("DUNE_ENV_FILE", "/workspace/.env")

# Module-level lock shared by ALL .env writers across the application.
env_file_lock = threading.Lock()


def _validate_value(value: str) -> None:
    """Reject values that could inject additional .env lines."""
    if any(c in value for c in ('\n', '\r', '\x00')):
        raise ValueError("Value contains invalid characters (newline/CR/null)")


def read_env_var(key: str, default: str | None = None) -> str | None:
    """Return the value of ``key`` from the .env file, or ``default`` if absent."""
    try:
        with open(ENV_PATH, encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.rstrip("\n")
                if line.startswith(f"{key}="):
                    return line[len(key) + 1:].strip().strip('"').strip("'").strip()
    except FileNotFoundError:
        pass
    return default


def write_env_var(key: str, value: str, *, quote: bool = False) -> None:
    """Upsert ``key=value`` in the .env file, preserving the rest of the file.

    Acquires ``env_file_lock`` internally — callers do **not** need to lock.
    """
    _validate_value(value)

    with env_file_lock:
        try:
            with open(ENV_PATH, encoding="utf-8") as handle:
                content = handle.read()
        except FileNotFoundError:
            content = ""

        rendered = f'"{value}"' if quote else value
        new_line = f"{key}={rendered}"
        pattern = rf"^{re.escape(key)}=.*$"
        if re.search(pattern, content, re.MULTILINE):
            content = re.sub(pattern, lambda _match: new_line, content, flags=re.MULTILINE)
        else:
            content = content.rstrip("\n") + f"\n{new_line}\n"

        with open(ENV_PATH, "w", encoding="utf-8") as handle:
            handle.write(content)
