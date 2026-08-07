-- Add is_alert_active to alerts table.
--
-- Tracks whether the alert-service considers the triggering condition currently
-- active (true = firing, false = cleared). Separate from alerts.status which
-- is a user workflow field (open / acknowledged / resolved) and is never
-- modified by the alert-service on a "closed" transition.

ALTER TABLE alerts ADD COLUMN is_alert_active BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: existing open alert_rule alerts are active.
UPDATE alerts SET is_alert_active = TRUE
WHERE status = 'open' AND trigger_type = 'alert_rule';

-- Replace the unique index so it gates on is_alert_active rather than status.
-- Previously: WHERE status = 'open' — but status is now a user workflow field
-- that stays 'open' until acknowledged/resolved. is_alert_active is set false
-- on "closed" transition, dropping the row from this index so the next "open"
-- can insert cleanly.
DROP INDEX IF EXISTS idx_alerts_one_open_per_rule_source;
CREATE UNIQUE INDEX idx_alerts_one_open_per_rule_source
ON alerts(org_id, rule_id, source_id)
WHERE is_alert_active = TRUE AND rule_id IS NOT NULL;
