-- Per-org RBAC permission overrides.
--
-- The action manifest (lib/manifest) declares each action's DEFAULT minimum
-- role. This table stores only the *deviations* an org's admin configures, so
-- it stays sparse: a row's absence means "use the manifest default".
--
-- required_role semantics:
--   'org:viewer' | 'org:editor' | 'org:admin' — override the minimum role
--   NULL                                       — explicitly available to all
--   (no row)                                   — fall back to manifest default

CREATE TABLE IF NOT EXISTS access_overrides (
  org_id        TEXT NOT NULL,
  action_id     TEXT NOT NULL,
  required_role TEXT,
  updated_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, action_id),
  CONSTRAINT access_overrides_role_chk
    CHECK (required_role IS NULL
           OR required_role IN ('org:viewer', 'org:editor', 'org:admin'))
);

CREATE INDEX IF NOT EXISTS access_overrides_org_id_idx
  ON access_overrides (org_id);

ALTER TABLE access_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "access_overrides_org_isolation"
  ON access_overrides
  FOR ALL USING (org_id = public.get_org_id());

CREATE POLICY "access_overrides_service_role"
  ON access_overrides FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_access_overrides_updated_at
  BEFORE UPDATE ON access_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
