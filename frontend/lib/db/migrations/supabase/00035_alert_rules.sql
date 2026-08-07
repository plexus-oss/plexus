-- alert_rules table for alert-service integration.
-- Sits alongside source_limits (which serves the gateway); alert_rules serves
-- the standalone alert-service with richer rule types (threshold, outlier, compound).

-- 1. New enums
CREATE TYPE alert_rule_type AS ENUM ('threshold', 'outlier', 'compound');
CREATE TYPE alert_rule_operator AS ENUM ('and', 'or');

-- 2. alert_rules table
CREATE TABLE alert_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              TEXT NOT NULL,
    source_id           UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    type                alert_rule_type NOT NULL,
    metric              TEXT,
    conditions          JSONB NOT NULL DEFAULT '{}'::jsonb,
    operator            alert_rule_operator,
    sub_rules           JSONB,
    hysteresis_seconds  INTEGER CHECK (hysteresis_seconds >= 0),
    cooldown_seconds    INTEGER CHECK (cooldown_seconds   >= 0),
    severity            TEXT NOT NULL DEFAULT 'warning',
    enabled             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT alert_rules_type_shape CHECK (
        (type = 'compound'   AND metric IS NULL      AND operator IS NOT NULL AND sub_rules IS NOT NULL)
        OR
        (type IN ('threshold','outlier') AND metric IS NOT NULL AND operator IS NULL AND sub_rules IS NULL)
    )
);

-- Indexes — bootstrap and per-org queries filter on enabled
CREATE INDEX idx_alert_rules_org        ON alert_rules(org_id) WHERE enabled;
CREATE INDEX idx_alert_rules_org_source ON alert_rules(org_id, source_id) WHERE enabled;

-- updated_at trigger (reuse existing function from 00001_schema.sql)
CREATE TRIGGER update_alert_rules_updated_at
BEFORE UPDATE ON alert_rules
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alert_rules_org_isolation" ON alert_rules FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "alert_rules_service_role"  ON alert_rules FOR ALL TO service_role USING (true);

-- 3. Extend alerts table for open-close matching
ALTER TABLE alerts ADD COLUMN rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL;

-- At most one open alert per (rule, source) at a time. Matches the
-- alert-service state machine guarantee that wire events strictly alternate
-- open/closed. Only applies to alert-service-created alerts (rule_id IS NOT NULL).
CREATE UNIQUE INDEX idx_alerts_one_open_per_rule_source
ON alerts(org_id, rule_id, source_id)
WHERE status = 'open' AND rule_id IS NOT NULL;

-- 4. Extend alert_trigger_type enum — add 'alert_rule'
ALTER TABLE alerts ALTER COLUMN trigger_type TYPE TEXT;
DROP TYPE IF EXISTS alert_trigger_type;
CREATE TYPE alert_trigger_type AS ENUM ('limit_violation', 'event', 'alert_rule');
ALTER TABLE alerts ALTER COLUMN trigger_type TYPE alert_trigger_type USING trigger_type::alert_trigger_type;

-- 5. Extend alert_event_type enum — add 'triggered'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_event_type') THEN
    ALTER TABLE alert_events ALTER COLUMN event_type TYPE TEXT;
    DROP TYPE alert_event_type;
    CREATE TYPE alert_event_type AS ENUM ('created', 'acknowledged', 'resolved', 'reopened', 'comment', 'triggered');
    ALTER TABLE alert_events ALTER COLUMN event_type TYPE alert_event_type USING event_type::alert_event_type;
  END IF;
END$$;
