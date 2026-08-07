-- RBAC Phase 3: restricted opt-in access for devices, with device + fleet grants.
--
-- A device (sources row) defaults to 'org' visibility (every member can view —
-- current behavior). When 'restricted', only the creator + admins + explicit
-- grants apply. Grants target an individual source OR a source_group ("fleet"),
-- whose dynamic membership covers current + future matching devices.

ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'org',
  ADD COLUMN IF NOT EXISTS created_by TEXT;

ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_visibility_chk;
ALTER TABLE sources
  ADD CONSTRAINT sources_visibility_chk CHECK (visibility IN ('org', 'restricted'));

CREATE TABLE IF NOT EXISTS source_permissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  source_id       UUID REFERENCES sources(id) ON DELETE CASCADE,
  source_group_id UUID REFERENCES source_groups(id) ON DELETE CASCADE,
  user_id         TEXT,
  email           TEXT,
  team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,
  access_level    TEXT NOT NULL DEFAULT 'view',
  invited_by      TEXT,
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT source_permissions_access_chk CHECK (access_level IN ('view', 'edit')),
  -- exactly one resource target
  CONSTRAINT source_permissions_one_resource
    CHECK ((source_id IS NOT NULL) <> (source_group_id IS NOT NULL)),
  -- at least one grantee
  CONSTRAINT source_permissions_grantee_present
    CHECK (user_id IS NOT NULL OR email IS NOT NULL OR team_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_source_permissions_org ON source_permissions (org_id);
CREATE INDEX IF NOT EXISTS idx_source_permissions_source ON source_permissions (source_id);
CREATE INDEX IF NOT EXISTS idx_source_permissions_group ON source_permissions (source_group_id);
CREATE INDEX IF NOT EXISTS idx_source_permissions_user ON source_permissions (org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_source_permissions_team ON source_permissions (team_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_permissions_unique
  ON source_permissions (
    COALESCE(source_id::text, ''),
    COALESCE(source_group_id::text, ''),
    COALESCE(user_id, ''),
    COALESCE(email, ''),
    COALESCE(team_id::text, '')
  );

ALTER TABLE source_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "source_permissions_org_isolation" ON source_permissions
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "source_permissions_service_role" ON source_permissions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_source_permissions_updated_at
  BEFORE UPDATE ON source_permissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
