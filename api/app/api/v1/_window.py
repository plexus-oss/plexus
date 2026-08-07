"""Shared time-window parsing for query endpoints."""

from datetime import datetime, timezone

from fastapi import HTTPException

_LAST_UNITS = {"m": 60_000, "h": 3_600_000, "d": 86_400_000}


def parse_window(
    last: str | None,
    start: datetime | None,
    end: datetime | None,
) -> tuple[int, int]:
    """Resolve (start_ms, end_ms) from `last` OR a start/end pair.

    Defaults to the last 1h when nothing is provided. Providing exactly one of
    start/end is a 400 (previously it silently fell back to the 1h default).
    """
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    if last is not None:
        unit = last[-1]
        value = last[:-1]
        if unit not in _LAST_UNITS or not value.isdigit():
            raise HTTPException(400, "invalid last — use e.g. 1h, 30m, 7d")
        return now_ms - int(value) * _LAST_UNITS[unit], now_ms
    if start is not None and end is not None:
        return int(start.timestamp() * 1000), int(end.timestamp() * 1000)
    if start is not None or end is not None:
        raise HTTPException(400, "start and end must be provided together")
    return now_ms - 3_600_000, now_ms  # default: last 1h
