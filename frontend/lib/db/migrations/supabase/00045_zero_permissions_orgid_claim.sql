-- Zero — permissions update for default Clerk session JWT.
--
-- The initial permissions (00044) read `authData.orgID` — that was
-- for a custom Clerk JWT template named "zero". We dropped the
-- template entirely (Clerk's docs deprecate per-service templates in
-- favor of the default session token), and the default token uses
-- `org_id` (snake_case, Clerk standard claim) instead.
--
-- This file is a single idempotent UPDATE — safe to re-run anytime.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'zero' AND table_name = 'permissions'
  ) THEN
    UPDATE zero.permissions SET permissions = '{"tables":{"dashboards":{"row":{"select":[["allow",{"type":"simple","left":{"type":"column","name":"org_id"},"right":{"type":"static","anchor":"authData","field":"org_id"},"op":"="}]],"update":{}}},"sources":{"row":{"select":[["allow",{"type":"simple","left":{"type":"column","name":"org_id"},"right":{"type":"static","anchor":"authData","field":"org_id"},"op":"="}]],"update":{}}},"api_keys":{"row":{"select":[["allow",{"type":"simple","left":{"type":"column","name":"org_id"},"right":{"type":"static","anchor":"authData","field":"org_id"},"op":"="}]],"update":{}}},"annotations":{"row":{"select":[["allow",{"type":"simple","left":{"type":"column","name":"org_id"},"right":{"type":"static","anchor":"authData","field":"org_id"},"op":"="}]],"update":{}}},"source_groups":{"row":{"select":[["allow",{"type":"simple","left":{"type":"column","name":"org_id"},"right":{"type":"static","anchor":"authData","field":"org_id"},"op":"="}]],"update":{}}},"webhooks":{"row":{"select":[["allow",{"type":"simple","left":{"type":"column","name":"org_id"},"right":{"type":"static","anchor":"authData","field":"org_id"},"op":"="}]],"update":{}}}}}';
    RAISE NOTICE 'Zero permissions updated to read org_id claim.';
  ELSE
    RAISE NOTICE 'zero.permissions not found — zero-cache hasn''t bootstrapped this DB yet. Skipping.';
  END IF;
END
$$;

COMMIT;
