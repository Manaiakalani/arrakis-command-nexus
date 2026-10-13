#!/usr/bin/env python3
"""Validate a Taking a Break request. Exit 0 only when the host should act.

The dashboard writes this file after the local backup succeeds. A stale file
must not power the machine off on a later boot.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path


def validate(path: Path, now: float, max_age: int) -> str | None:
    """Return an error string, or None when the request is safe to run."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return "request file is unreadable"
    if not isinstance(payload, dict):
        return "request file is unreadable"
    if payload.get("action") != "poweroff":
        return "request action is not poweroff"
    try:
        requested = float(payload["requested_at_unix"])
    except (KeyError, TypeError, ValueError):
        return "request timestamp is missing"
    age = now - requested
    if age < -30 or age > max_age:
        return "request is stale"
    return None


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: taking_a_break_validate.py REQUEST [MAX_AGE_SECONDS]", file=sys.stderr)
        return 2
    max_age = int(argv[2]) if len(argv) > 2 else 900
    reason = validate(Path(argv[1]), time.time(), max_age)
    if reason:
        print(reason, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
