-- RBAC unify: the "groups" model. Roles and teams are both groups; any group
-- can carry BOTH capabilities and resource access.
--
--  1. team_permissions: a team can grant capabilities (action_ids) additively
--     on top of its members' org-role baseline.
--  2. source_permissions.role / dashboard_permissions.role: an access grant can
--     target an org role (e.g. all viewers), alongside user/email/team.

-- ---------------------------------------------------------------------------
-- 1. Team capability grants (additive; grant-only, never restrict)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      TEXT NOT NULL,
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  action_id   TEXT NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT team_permissions_unique UNIQUE (org_id, team_id, action_id)
);

CREATE INDEX IF NOT EXISTS idx_team_permissions_org_team
  ON team_permissions (org_id, team_id);

ALTER TABLE team_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_permissions_org_isolation" ON team_permissions
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "team_permissions_service_role" ON team_permissions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2. Role-targeted access grants. Subject is one of {user_id, email, team_id,
--    role}; `role` holds 'org:viewer' | 'org:editor' | 'org:admin'.
-- ---------------------------------------------------------------------------

-- Sources (devices / fleets)
ALTER TABLE source_permissions ADD COLUMN IF NOT EXISTS role TEXT;

ALTER TABLE source_permissions
  DROP CONSTRAINT IF EXISTS source_permissions_role_chk;
ALTER TABLE source_permissions
  ADD CONSTRAINT source_permissions_role_chk
    CHECK (role IS NULL OR role IN ('org:viewer', 'org:editor', 'org:admin'));

ALTER TABLE source_permissions
  DROP CONSTRAINT IF EXISTS source_permissions_grantee_present;
ALTER TABLE source_permissions
  ADD CONSTRAINT source_permissions_grantee_present
    CHECK (
      user_id IS NOT NULL OR email IS NOT NULL
      OR team_id IS NOT NULL OR role IS NOT NULL
    );

DROP INDEX IF EXISTS idx_source_permissions_unique;
CREATE UNIQUE INDEX idx_source_permissions_unique
  ON source_permissions (
    COALESCE(source_id::text, ''),
    COALESCE(source_group_id::text, ''),
    COALESCE(user_id, ''),
    COALESCE(email, ''),
    COALESCE(team_id::text, ''),
    COALESCE(role, '')
  );

CREATE INDEX IF NOT EXISTS idx_source_permissions_role
  ON source_permissions (org_id, role);

-- Dashboards
ALTER TABLE dashboard_permissions ADD COLUMN IF NOT EXISTS role TEXT;

ALTER TABLE dashboard_permissions
  DROP CONSTRAINT IF EXISTS dashboard_permissions_role_chk;
ALTER TABLE dashboard_permissions
  ADD CONSTRAINT dashboard_permissions_role_chk
    CHECK (role IS NULL OR role IN ('org:viewer', 'org:editor', 'org:admin'));

ALTER TABLE dashboard_permissions
  DROP CONSTRAINT IF EXISTS dashboard_permissions_grantee_present;
ALTER TABLE dashboard_permissions
  ADD CONSTRAINT dashboard_permissions_grantee_present
    CHECK (
      user_id IS NOT NULL OR email IS NOT NULL
      OR team_id IS NOT NULL OR role IS NOT NULL
    );

DROP INDEX IF EXISTS idx_dashboard_permissions_unique;
CREATE UNIQUE INDEX idx_dashboard_permissions_unique
  ON dashboard_permissions (
    dashboard_id,
    COALESCE(user_id, ''),
    COALESCE(email, ''),
    COALESCE(team_id::text, ''),
    COALESCE(role, '')
  );

CREATE INDEX IF NOT EXISTS idx_dashboard_permissions_role
  ON dashboard_permissions (org_id, role);
