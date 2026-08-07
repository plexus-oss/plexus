-- Add access_enabled flag to api_keys.
-- Gates data_api authentication: true = requests allowed, false = 402.
-- Managed exclusively by billing webhooks; never set by user-facing code.
--
-- DEFAULT TRUE: all existing keys belong to orgs that passed the old
-- delete-based gating (team-tier enforcer already cleaned up non-paying orgs),
-- so they start enabled. Webhooks will immediately correct any that shouldn't
-- be active on next billing event.

ALTER TABLE api_keys
  ADD COLUMN access_enabled BOOLEAN NOT NULL DEFAULT TRUE;
