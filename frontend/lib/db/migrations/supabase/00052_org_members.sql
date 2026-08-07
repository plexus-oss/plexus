-- Phase 2: org identity mirror for local dev / on-prem without Clerk.
-- Adds org_name, org_created_at, drip_markers to org_billing (created in
-- 00049) and creates org_members.

ALTER TABLE org_billing
  ADD COLUMN IF NOT EXISTS org_name       TEXT,
  ADD COLUMN IF NOT EXISTS org_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS drip_markers   JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS org_members (
  org_id     TEXT        NOT NULL,
  user_id    TEXT        NOT NULL,
  email      TEXT,
  first_name TEXT,
  last_name  TEXT,
  role       TEXT        NOT NULL DEFAULT 'org:member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_service_role"
  ON org_members FOR ALL TO service_role
  USING (true) WITH CHECK (true);
