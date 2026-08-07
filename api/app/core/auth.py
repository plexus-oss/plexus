import hashlib
import time
from dataclasses import dataclass

from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine

@dataclass
class _Entry:
    org_id: str | None      # None = negative entry (key not found)
    access_enabled: bool    # only meaningful when org_id is not None
    expires_at: float


# In-process cache — move to Redis if running multiple replicas.
# Bounded: once the dict exceeds _CACHE_SWEEP_THRESHOLD entries, each insert
# first sweeps expired entries. Size therefore stays around the threshold plus
# however many entries are still live (TTLs are ≤ auth_cache_ttl, default 300s),
# instead of growing forever on unique/invalid keys.
_CACHE_SWEEP_THRESHOLD = 10_000
_cache: dict[str, _Entry] = {}


def _cache_put(api_key: str, entry: _Entry) -> None:
    if len(_cache) > _CACHE_SWEEP_THRESHOLD:
        now = time.monotonic()
        for k in [k for k, v in _cache.items() if v.expires_at <= now]:
            del _cache[k]
    _cache[api_key] = entry


async def verify_api_key(api_key: str) -> tuple[str, bool] | None:
    """Return (org_id, access_enabled) if the key exists, None if the key is invalid."""
    if not (api_key.startswith("plx_") and len(api_key) == 36):
        return None

    now = time.monotonic()
    cached = _cache.get(api_key)

    if cached is not None and cached.expires_at > now:
        if cached.org_id is None:
            return None
        return (cached.org_id, cached.access_enabled)

    key_hash = hashlib.sha256(api_key.encode()).hexdigest()

    async with engine.connect() as conn:
        row = await conn.execute(
            text(
                "SELECT org_id, access_enabled FROM api_keys"
                " WHERE key_hash = :h"
                " AND (expires_at IS NULL OR expires_at > NOW())"
                " LIMIT 1"
            ),
            {"h": key_hash},
        )
        record = row.fetchone()

    if not record:
        _cache_put(api_key, _Entry(org_id=None, access_enabled=False, expires_at=now + settings.auth_negative_cache_ttl))
        return None

    org_id = record.org_id
    access_enabled = bool(record.access_enabled)

    ttl = settings.auth_cache_ttl if access_enabled else settings.auth_disabled_cache_ttl
    _cache_put(api_key, _Entry(org_id=org_id, access_enabled=access_enabled, expires_at=now + ttl))
    return (org_id, access_enabled)
