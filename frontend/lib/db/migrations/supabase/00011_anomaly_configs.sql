-- Anomaly detection configurations: per-source, per-metric anomaly rules
CREATE TABLE anomaly_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm IN ('zscore', 'rate_of_change', 'iqr', 'moving_average', 'ensemble')),
  sensitivity NUMERIC NOT NULL DEFAULT 2,
  window_size INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_anomaly_configs_unique ON anomaly_configs(org_id, source_id, metric);
CREATE INDEX idx_anomaly_configs_source ON anomaly_configs(org_id, source_id);
CREATE INDEX idx_anomaly_configs_enabled ON anomaly_configs(org_id, enabled) WHERE enabled = true;

ALTER TABLE anomaly_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anomaly_configs_org_isolation" ON anomaly_configs
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "anomaly_configs_service_role" ON anomaly_configs
  FOR ALL TO service_role USING (true);
CREATE TRIGGER update_anomaly_configs_updated_at
  BEFORE UPDATE ON anomaly_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
