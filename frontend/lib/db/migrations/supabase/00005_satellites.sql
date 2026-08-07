-- Satellites catalog table
-- User-configurable satellite entities backed by CelesTrak TLE data

CREATE TABLE satellites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  norad_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  official_name TEXT,
  color TEXT DEFAULT '#3b82f6',
  group_name TEXT,
  tle_line1 TEXT,
  tle_line2 TEXT,
  tle_epoch TIMESTAMPTZ,
  tle_fetched_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_satellites_org_norad ON satellites(org_id, norad_id);
CREATE INDEX idx_satellites_org_id ON satellites(org_id);
CREATE INDEX idx_satellites_group ON satellites(org_id, group_name);

ALTER TABLE satellites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "satellites_org_isolation" ON satellites FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "satellites_service_role" ON satellites FOR ALL TO service_role USING (true);
CREATE TRIGGER update_satellites_updated_at BEFORE UPDATE ON satellites FOR EACH ROW EXECUTE FUNCTION update_updated_at();
