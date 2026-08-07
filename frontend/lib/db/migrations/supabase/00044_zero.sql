-- Zero — full DB state for replication + permissions.
--
-- IDEMPOTENT. Every destructive step has an explicit DROP or
-- IF (NOT) EXISTS guard so partial state from prior runs is wiped
-- before the rebuild. Re-run anytime, in any DB (dev or prod):
--
--   psql "$YOUR_DB_URL" -f lib/db/migrations/supabase/00044_zero.sql
--
-- or paste the whole file into Supabase SQL Editor.
--
-- Two responsibilities:
--   1. Postgres-side prep: column adds, publication definition.
--   2. zero-cache permissions: org isolation on every table.
--
-- The permissions UPDATE is wrapped in a guard — if `zero.permissions`
-- doesn't exist yet (zero-cache hasn't bootstrapped this DB), the
-- statement is skipped with a notice. After zero-cache deploys
-- against this DB and creates the metadata schema, re-run this file
-- to apply permissions.

BEGIN;

-- =========================================================================
-- 1. Drop the publication FIRST.
--
--    Postgres tracks column dependencies between publications and
--    tables: if `webhooks.secret_prefix` is in `zero_publication`,
--    we can't drop the column until the publication is gone.
--    Step 2 will recreate the publication after the column rebuild.
-- =========================================================================

DROP PUBLICATION IF EXISTS zero_publication;

-- =========================================================================
-- 2. Schema prep
-- =========================================================================

-- webhooks.secret_prefix: first 8 chars of secret, replicated to
-- clients while the full secret stays server-only.
--
-- Drop-first ensures any stale shape (wrong type, wrong NOT NULL
-- state from a partial earlier run) is wiped before we recreate.
-- We always recompute the value from current `secret` so it can't
-- drift from a prior backfill.
ALTER TABLE public.webhooks
  DROP COLUMN IF EXISTS secret_prefix;

ALTER TABLE public.webhooks
  ADD COLUMN secret_prefix TEXT;

UPDATE public.webhooks
  SET secret_prefix = SUBSTRING(secret FROM 1 FOR 8);

ALTER TABLE public.webhooks
  ALTER COLUMN secret_prefix SET NOT NULL;

-- =========================================================================
-- 3. zero_publication — canonical table + column lists.
--
--    Recreating from scratch after the dropping in step 1.
--    zero-cache reconnects and rediscovers tables on its next
--    replication slot read.
-- =========================================================================

CREATE PUBLICATION zero_publication FOR TABLE
  public.dashboards,

  public.sources (
    id, org_id, source_type, slug, name, description, status,
    last_seen_at, last_connected_at, last_error, device_type,
    connection_type, config, metadata, created_at, updated_at
    -- credentials_encrypted, ssh_credentials_encrypted EXCLUDED
  ),

  public.api_keys (
    id, org_id, name, key_prefix, scopes,
    last_used_at, expires_at, created_at
    -- key_hash EXCLUDED. access_enabled omitted until migration 00042
    -- runs in every env.
  ),

  public.annotations,

  public.source_groups,

  public.webhooks (
    id, org_id, name, description, url, secret_prefix, events,
    source_filter, custom_headers, enabled,
    total_deliveries, successful_deliveries, failed_deliveries,
    last_triggered_at, last_success_at, last_failure_at, last_error,
    created_by, created_at, updated_at
    -- secret EXCLUDED
  );

-- =========================================================================
-- 3. Permissions — applied if zero-cache has already bootstrapped.
--    If not, skipped silently; re-run this file after deploy.
--
--    Regenerate the JSON below when `lib/zero/permissions.ts` changes:
--
--      npx tsx node_modules/.bin/zero-deploy-permissions \
--        --schema-path ./lib/zero/permissions.ts \
--        --output-file /tmp/zero-perms.sql \
--        --output-format sql
--
--    Then copy the JSON string from /tmp/zero-perms.sql and paste it
--    into the UPDATE statement inside the DO block below.
-- =========================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'zero' AND table_name = 'permissions'
  ) THEN
    UPDATE zero.permissions SET permissions = '{"tables":{"dashboards":{"row":{"select":[["allow",{"type":"simple","left":{"type":"column","name":"org_id"},"right":{"type":"static","anchor":"authData","field":"orgID"},"op":"="}]],"update":{}}},"sources":{"row":{"select":[["allow",{"type":"simple","left":{"type":"column","name":"org_id"},"right":{"type":"static","anchor":"authData","field":"orgID"},"op":"="}]],"update":{}}},"api_keys":{"row":{"select":[["allow",{"type":"simple","left":{"type":"column","name":"org_id"},"right":{"type":"static","anchor":"authData","field":"orgID"},"op":"="}]],"update":{}}},"annotations":{"row":{"select":[["allow",{"type":"simple","left":{"type":"column","name":"org_id"},"right":{"type":"static","anchor":"authData","field":"orgID"},"op":"="}]],"update":{}}},"source_groups":{"row":{"select":[["allow",{"type":"simple","left":{"type":"column","name":"org_id"},"right":{"type":"static","anchor":"authData","field":"orgID"},"op":"="}]],"update":{}}},"webhooks":{"row":{"select":[["allow",{"type":"simple","left":{"type":"column","name":"org_id"},"right":{"type":"static","anchor":"authData","field":"orgID"},"op":"="}]],"update":{}}}}}';
    RAISE NOTICE 'Zero permissions applied.';
  ELSE
    RAISE NOTICE 'zero.permissions table not found — zero-cache has not bootstrapped this DB yet. Deploy zero-cache against this DB, then re-run this migration to apply permissions.';
  END IF;
END
$$;

COMMIT;
