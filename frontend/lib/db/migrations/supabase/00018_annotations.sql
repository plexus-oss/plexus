-- Create annotations table for persistent telemetry annotations
CREATE TABLE annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'device',
  source_id TEXT,
  telemetry_id TEXT,
  session_id TEXT,
  timestamp_start TIMESTAMPTZ NOT NULL,
  timestamp_end TIMESTAMPTZ,
  metric_name TEXT,
  value_snapshot JSONB,
  label TEXT NOT NULL,
  notes TEXT,
  color TEXT DEFAULT 'amber',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;

-- Org isolation policy
CREATE POLICY "annotations_org_isolation" ON annotations
  FOR ALL USING (org_id = public.get_org_id());

-- Service role bypass
CREATE POLICY "annotations_service_role" ON annotations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX idx_annotations_source_time ON annotations(org_id, source_id, timestamp_start);
CREATE INDEX idx_annotations_session ON annotations(org_id, session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_annotations_time_range ON annotations(org_id, timestamp_start, timestamp_end) WHERE timestamp_end IS NOT NULL;

-- Updated_at trigger
CREATE TRIGGER update_annotations_updated_at
  BEFORE UPDATE ON annotations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
