-- Device schema registry: auto-captured metric schemas per source
CREATE TABLE device_schemas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('number', 'string', 'boolean', 'object', 'array')),
  sample_count BIGINT NOT NULL DEFAULT 1,
  min_value DOUBLE PRECISION,
  max_value DOUBLE PRECISION,
  last_value_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_device_schemas_unique ON device_schemas(org_id, source_id, metric);
CREATE INDEX idx_device_schemas_source ON device_schemas(org_id, source_id);

ALTER TABLE device_schemas ENABLE ROW LEVEL SECURITY;
-- Org users can only READ schemas (writes come from ingest via service_role)
CREATE POLICY "device_schemas_org_read" ON device_schemas
  FOR SELECT USING (org_id = public.get_org_id());
CREATE POLICY "device_schemas_service_role" ON device_schemas
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Atomic upsert function for schema capture (avoids read-then-write race conditions)
CREATE OR REPLACE FUNCTION upsert_device_schemas(
  p_org_id TEXT,
  p_source_id TEXT,
  p_metrics JSONB
) RETURNS void AS $$
DECLARE
  m JSONB;
BEGIN
  FOR m IN SELECT * FROM jsonb_array_elements(p_metrics)
  LOOP
    INSERT INTO device_schemas (org_id, source_id, metric, value_type, sample_count, min_value, max_value, last_value_at, first_seen_at)
    VALUES (
      p_org_id,
      p_source_id,
      m->>'metric',
      m->>'value_type',
      (m->>'sample_count')::BIGINT,
      (m->>'min_value')::DOUBLE PRECISION,
      (m->>'max_value')::DOUBLE PRECISION,
      NOW(),
      NOW()
    )
    ON CONFLICT (org_id, source_id, metric) DO UPDATE SET
      sample_count = device_schemas.sample_count + EXCLUDED.sample_count,
      min_value = LEAST(device_schemas.min_value, EXCLUDED.min_value),
      max_value = GREATEST(device_schemas.max_value, EXCLUDED.max_value),
      last_value_at = NOW(),
      updated_at = NOW();
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER update_device_schemas_updated_at
  BEFORE UPDATE ON device_schemas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
