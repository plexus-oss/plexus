-- Delivery health stats for Slack integrations, matching what
-- email_integrations and pagerduty_integrations already track. Gives users
-- visibility into whether their Slack notifications are actually landing.

ALTER TABLE slack_integrations
  ADD COLUMN total_events INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN successful_events INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN failed_events INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_event_at TIMESTAMPTZ,
  ADD COLUMN last_error TEXT;
