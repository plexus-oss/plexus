ALTER TABLE alerts RENAME COLUMN telemetry_snapshot TO alert_stats;
ALTER TABLE alerts ADD COLUMN closed_at TIMESTAMPTZ;
