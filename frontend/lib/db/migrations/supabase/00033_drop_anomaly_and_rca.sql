-- Drop anomaly detection and RCA features entirely.
-- Removes: anomaly_configs table, alert RCA columns, alert_trigger_type 'anomaly' value,
-- alert_event_type 'analysis_complete' value.

-- 1. Drop anomaly_configs table
DROP TABLE IF EXISTS anomaly_configs CASCADE;

-- 2. Drop RCA-related columns from alerts
ALTER TABLE alerts DROP COLUMN IF EXISTS rca;
ALTER TABLE alerts DROP COLUMN IF EXISTS analysis_confidence;
ALTER TABLE alerts DROP COLUMN IF EXISTS analysis_model;
ALTER TABLE alerts DROP COLUMN IF EXISTS analysis_completed_at;
ALTER TABLE alerts DROP COLUMN IF EXISTS probing_questions;
ALTER TABLE alerts DROP COLUMN IF EXISTS correlated_anomalies;

-- 3. Rewrite alert_trigger_type enum without 'anomaly'
--    Postgres does not support removing enum values, so we recreate the type.
ALTER TABLE alerts ALTER COLUMN trigger_type TYPE TEXT;
DROP TYPE IF EXISTS alert_trigger_type;
CREATE TYPE alert_trigger_type AS ENUM ('limit_violation', 'event');
UPDATE alerts SET trigger_type = 'limit_violation' WHERE trigger_type = 'anomaly';
ALTER TABLE alerts ALTER COLUMN trigger_type TYPE alert_trigger_type USING trigger_type::alert_trigger_type;

-- 4. Rewrite alert_event_type enum without 'analysis_complete' (if it exists as an enum)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_event_type') THEN
    ALTER TABLE alert_events ALTER COLUMN event_type TYPE TEXT;
    DROP TYPE alert_event_type;
    CREATE TYPE alert_event_type AS ENUM ('created', 'acknowledged', 'resolved', 'reopened', 'comment');
    DELETE FROM alert_events WHERE event_type = 'analysis_complete';
    ALTER TABLE alert_events ALTER COLUMN event_type TYPE alert_event_type USING event_type::alert_event_type;
  END IF;
END$$;
