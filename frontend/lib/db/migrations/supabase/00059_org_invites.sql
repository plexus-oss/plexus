-- Phase 4d: org member invitations (replaces Clerk's invitation flow).
-- Tokens are stored hashed (sha256) — a DB read can't mint an accept link.

CREATE TABLE IF NOT EXISTS org_invites (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      TEXT        NOT NULL,
  email       TEXT        NOT NULL,
  role        TEXT        NOT NULL DEFAULT 'org:member',
  token_hash  TEXT        NOT NULL UNIQUE,
  invited_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_org_invites_org_id ON org_invites (org_id);

ALTER TABLE org_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_invites_service_role"
  ON org_invites FOR ALL TO service_role
  USING (true) WITH CHECK (true);
