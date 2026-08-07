-- Org Preferences Migration
--
-- Generic key/value store for org-level configuration.
-- First use: tle_source_priority (ordered list of TLE sources).

CREATE TABLE IF NOT EXISTS org_preferences (
  org_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, key)
);

CREATE INDEX IF NOT EXISTS org_preferences_org_id_idx ON org_preferences (org_id);

ALTER TABLE org_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_preferences_org_isolation" ON org_preferences
  FOR ALL USING (org_id = public.get_org_id());

CREATE POLICY "org_preferences_service_role" ON org_preferences
  FOR ALL TO service_role USING (true);

CREATE TRIGGER update_org_preferences_updated_at
  BEFORE UPDATE ON org_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
