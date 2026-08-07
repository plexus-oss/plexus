-- Event monitors: fire an alert on every new data point for a source+metric
CREATE TABLE event_monitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('critical', 'warning', 'info')),
  message TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_event_monitors_unique ON event_monitors(org_id, source_id, metric);
CREATE INDEX idx_event_monitors_source ON event_monitors(org_id, source_id);
CREATE INDEX idx_event_monitors_enabled ON event_monitors(org_id, enabled) WHERE enabled = true;

ALTER TABLE event_monitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_monitors_org_isolation" ON event_monitors
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "event_monitors_service_role" ON event_monitors
  FOR ALL TO service_role USING (true);
CREATE TRIGGER update_event_monitors_updated_at
  BEFORE UPDATE ON event_monitors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
