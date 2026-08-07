# TODO

- [ ] Switch loader back to internal-only networking now that the frontend push runs over 6PN

## Context

The loader is currently exposed publicly (ports 80/443 -> 8080 via the fly.toml
[http_service]) to allow the Next.js frontend to push recording updates.

The original justification was a Vercel-hosted frontend that couldn't reach Fly
6PN addresses. The prod frontend now runs on Fly and already targets
`plexus-ch-loader.internal:8080` (frontend PLEXUS_LOADER_URL), so the public
port can likely just be dropped. Alternatives if a non-6PN caller ever needs it:
- Option A: keep the push over internal Fly networking (current default)
- Option B: Use Redis pub/sub instead of HTTP push
- Option C: Use a webhook from Fly API

Then revert fly.toml to internal-only by removing the [http_service] section.

## Related

- Frontend uses `PLEXUS_LOADER_URL` env var to push to loader
- Push happens in app/api/sources/[id]/route.ts and app/api/sources/register/route.ts
- pushToService in lib/internal/push.ts handles the HTTP POST

## ch-loader: XAUTOCLAIM + 2-replica HA

Full design in `SCALING.md`. Steps in order:

- [ ] **Add `xautoclaim_sweep` task to `loader.py`** — parallel asyncio task alongside `ingest_loop`. Sweeps the ch-loader consumer group PEL every 60s and reclaims entries idle > 5 min from any dead peer. Sketch is in SCALING.md; ~40 lines.

- [ ] **Switch `CONSUMER_NAME` default to `FLY_MACHINE_ID`** — one line change. Each machine needs a distinct consumer name so they don't share a PEL. Currently hardcoded to `loader-0`.

  ```python
  CONSUMER_NAME = os.environ.get(
      "CONSUMER_NAME",
      f"loader-{os.environ.get('FLY_MACHINE_ID', 'local')[:8]}",
  )
  ```

- [ ] **`fly scale count 2 -a plexus-ch-loader`** — once the two tasks above are deployed.

- [ ] **Verify with `XINFO GROUPS`** after scaling:
  ```bash
  fly ssh console -a plexus-ch-loader -C \
    "redis-cli -u $REDIS_URL XINFO GROUPS telemetry.stream:<any-org-id>"
  ```

## ch-loader: vestigial shard code cleanup

`LOADER_SHARD_ID` / `LOADER_SHARD_COUNT` and the `_owns_org()` hash function in `loader.py` were dead code — consumer groups distribute messages naturally.

- [x] Remove `LOADER_SHARD_ID`, `LOADER_SHARD_COUNT` env vars from `loader.py`, `fly.toml`, and `.env.example`
- [x] Delete `_owns_org()` and the shard ownership check in `discover_streams()`
- [x] Remove the `if LOADER_SHARD_COUNT > 1: log.info(...)` startup log