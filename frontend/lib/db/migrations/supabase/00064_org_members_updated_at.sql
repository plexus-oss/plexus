-- Repair org_members on databases where the table predated 00058.
--
-- org_members was first created in 00051 (identity mirror: email/name/avatar +
-- role, default 'org:member', no updated_at). 00058 then ran its
-- CREATE TABLE IF NOT EXISTS — a no-op against the existing table — so its
-- updated_at column and 'org:viewer' default never applied, BUT its
-- BEFORE UPDATE trigger (update_org_members_updated_at) did. The result is a
-- table whose every write fails with: record "new" has no field "updated_at".
--
-- This adds the missing column, aligns the role default, normalizes the legacy
-- 'org:member' default rows from 00051, and ensures the lookup index exists.
-- All idempotent; harmless on fresh databases (00058 already added the column).

ALTER TABLE org_members
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE org_members ALTER COLUMN role SET DEFAULT 'org:viewer';

UPDATE org_members SET role = 'org:viewer' WHERE role = 'org:member';

CREATE INDEX IF NOT EXISTS idx_org_members_org_role ON org_members (org_id, role);
