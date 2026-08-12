"""Time-window parsing for MCP tools.

Wraps app/api/v1/_window.py so its HTTPException surfaces as a plain
ValueError, which FastMCP reports as a readable tool error instead of an
opaque server error.
"""

from datetime import datetime

from fastapi import HTTPException

from app.api.v1._window import parse_window as _parse_window


def _parse_dt(value: str | None, label: str) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{label} must be an ISO 8601 datetime, got {value!r}")


def parse_window(last: str | None, start: str | None, end: str | None) -> tuple[int, int]:
    try:
        return _parse_window(last, _parse_dt(start, "start"), _parse_dt(end, "end"))
    except HTTPException as e:
        raise ValueError(e.detail)
