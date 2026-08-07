-- Billing state for each org, migrated from Clerk org private_metadata.
-- All reads and writes go through service_role (server-side only).

CREATE TABLE IF NOT EXISTS org_billing (
  org_id                                TEXT        PRIMARY KEY,
  tier                                  TEXT        NOT NULL DEFAULT 'tier_1',
  stripe_customer_id                    TEXT,
  stripe_subscription_status            TEXT,
  enterprise_info                       JSONB,
  monthly_spend_cap_usd                 NUMERIC,
  platform_fee_usd                      NUMERIC,
  free_tier_revoked_key_ids             TEXT[]      NOT NULL DEFAULT '{}',
  spend_cap_revoked_key_ids             TEXT[]      NOT NULL DEFAULT '{}',
  high_burn_thresholds_alerted          JSONB,
  free_tier_breach_email_sent_for_month TEXT,
  updated_at                            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE org_billing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_billing_service_role"
  ON org_billing FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_org_billing_updated_at
  BEFORE UPDATE ON org_billing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
