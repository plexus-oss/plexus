-- Add type column to sessions table to distinguish how sessions were created
-- 'device' = created by device agent (existing behavior)
-- 'live' = started from UI, telemetry auto-tagged server-side
-- 'retrospective' = created from historical data using time range
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'device';
