-- Operator verdict on an alert ("helpful" / "noise").
--
-- This is the training signal for default-silence (PLAN.md): the on-call judgment
-- of whether an alert was worth firing. It used to be POSTed to the generic
-- `feedback` table with the alert id stringified into a title — unrecoverable.
--
-- We now tie the verdict to the alert it judges (denormalized `current_verdict`
-- here, plus a typed `verdict` row in `alert_events`) and — crucially — let it roll
-- up to the RULE/LIMIT that fired, since that is what the silence engine tunes.
--
-- `alert_events.event_type` is free-form TEXT, so the new `verdict` event type needs
-- no schema change here.

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS current_verdict TEXT
  CHECK (current_verdict IN ('helpful', 'noise'));

-- Fast per-rule / per-limit verdict rollups (noise-rate) for context hydration at
-- fire time. Partial — only verdicted alerts participate.
CREATE INDEX IF NOT EXISTS alerts_rule_verdict_idx
  ON alerts (org_id, rule_id)
  WHERE current_verdict IS NOT NULL;

CREATE INDEX IF NOT EXISTS alerts_limit_verdict_idx
  ON alerts (org_id, limit_id)
  WHERE current_verdict IS NOT NULL;
