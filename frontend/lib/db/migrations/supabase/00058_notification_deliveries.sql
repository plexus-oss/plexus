-- Durable delivery records for integration notifications (Slack, email,
-- PagerDuty). Mirrors the webhook_deliveries state machine so a failed or
-- interrupted send is retried by the drain loop instead of being lost.

CREATE TABLE notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('slack', 'email', 'pagerduty')),
  integration_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'retrying', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  response_status INTEGER,
  response_body TEXT,
  response_time_ms INTEGER,
  error TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_retry_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX notification_deliveries_org_created_idx
  ON notification_deliveries(org_id, created_at DESC);
CREATE INDEX notification_deliveries_integration_idx
  ON notification_deliveries(org_id, integration_id, created_at DESC);
CREATE INDEX notification_deliveries_pending_retry_idx
  ON notification_deliveries(status, next_retry_at)
  WHERE status IN ('pending', 'retrying');

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_deliveries_org_isolation" ON notification_deliveries
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "notification_deliveries_service_role" ON notification_deliveries
  FOR ALL TO service_role USING (true);
