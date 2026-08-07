-- Teams + dashboard access enforcement (RBAC Phase 2).
--
-- Teams are static, admin-managed groups of org members. Dashboards gain a
-- "restricted opt-in" visibility model: 'org' (default — every member can view,
-- current behavior) or 'restricted' (only creator + admins + explicit grants).
-- Grants reuse the existing dashboard_permissions table, extended with team_id.

-- ── Teams ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT,
  icon        TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teams_org_id ON teams (org_id);

-- org_id is denormalized onto team_members so the standard org-isolation RLS
-- policy applies uniformly (matches every other table in this schema).
CREATE TABLE IF NOT EXISTS team_members (
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  org_id     TEXT NOT NULL,
  added_by   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_org_id ON team_members (org_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members (org_id, user_id);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teams_org_isolation" ON teams
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "teams_service_role" ON teams
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "team_members_org_isolation" ON team_members
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "team_members_service_role" ON team_members
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_teams_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Dashboard access (restricted opt-in) ────────────────────────────────────

ALTER TABLE dashboards
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'org',
  ADD COLUMN IF NOT EXISTS created_by TEXT;

ALTER TABLE dashboards
  DROP CONSTRAINT IF EXISTS dashboards_visibility_chk;
ALTER TABLE dashboards
  ADD CONSTRAINT dashboards_visibility_chk
    CHECK (visibility IN ('org', 'restricted'));

-- Team grants live alongside user/email grants in dashboard_permissions.
ALTER TABLE dashboard_permissions
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE dashboard_permissions
  DROP CONSTRAINT IF EXISTS dashboard_permissions_user_or_email;
ALTER TABLE dashboard_permissions
  ADD CONSTRAINT dashboard_permissions_grantee_present
    CHECK (user_id IS NOT NULL OR email IS NOT NULL OR team_id IS NOT NULL);

-- Rebuild the uniqueness guard to include the team grantee.
DROP INDEX IF EXISTS idx_dashboard_permissions_unique;
CREATE UNIQUE INDEX idx_dashboard_permissions_unique
  ON dashboard_permissions (
    dashboard_id,
    COALESCE(user_id, ''),
    COALESCE(email, ''),
    COALESCE(team_id::text, '')
  );

CREATE INDEX IF NOT EXISTS idx_dashboard_permissions_team_id
  ON dashboard_permissions (team_id);
