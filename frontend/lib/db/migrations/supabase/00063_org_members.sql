-- App-owned org member roles.
--
-- Clerk keeps identity, org membership, and email invitations; the member's
-- role (org:admin | org:editor | org:viewer) lives here and is the single
-- source of truth for RBAC. Rows are written by the Clerk membership webhook
-- and lazily bootstrapped on first authed request (Clerk org:admin → admin,
-- anything else → viewer).

CREATE TABLE IF NOT EXISTS org_members (
  org_id     TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'org:viewer'
               CHECK (role IN ('org:admin', 'org:editor', 'org:viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

-- The PK covers the per-request (org_id, user_id) lookup; this serves
-- countAdmins / role listings.
CREATE INDEX IF NOT EXISTS idx_org_members_org_role ON org_members (org_id, role);

ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- Idempotent: CREATE POLICY/TRIGGER have no IF NOT EXISTS, so drop first
-- to keep the whole file safely re-runnable after a partial apply.
DROP POLICY IF EXISTS "org_members_org_isolation" ON org_members;
CREATE POLICY "org_members_org_isolation" ON org_members
  FOR ALL USING (org_id = public.get_org_id());

DROP POLICY IF EXISTS "org_members_service_role" ON org_members;
CREATE POLICY "org_members_service_role" ON org_members
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_org_members_updated_at ON org_members;
CREATE TRIGGER update_org_members_updated_at
  BEFORE UPDATE ON org_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
