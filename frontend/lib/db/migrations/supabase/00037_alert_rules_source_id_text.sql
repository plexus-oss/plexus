-- Change alert_rules.source_id from UUID FK → TEXT (source slug).
--
-- The alert-service wire format uses source slugs, not UUIDs, so storing the
-- slug directly removes the need for a JOIN every time we serialize rules.
-- This matches the pattern used by device_schemas.source_id.

-- Drop the FK constraint (auto-named by Postgres).
ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_source_id_fkey;

-- Drop the partial index before altering the column type.
DROP INDEX IF EXISTS idx_alert_rules_org_source;

-- Change column type. Cast is safe because UUID strings are valid TEXT.
ALTER TABLE alert_rules ALTER COLUMN source_id TYPE TEXT;

-- Recreate the partial index with the same predicate.
CREATE INDEX idx_alert_rules_org_source ON alert_rules(org_id, source_id) WHERE enabled;
