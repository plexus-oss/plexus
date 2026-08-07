-- Email Integrations
CREATE TABLE email_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email_address TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  events TEXT[] NOT NULL DEFAULT ARRAY['alert.triggered', 'alert.resolved']::TEXT[],
  total_events INTEGER NOT NULL DEFAULT 0,
  successful_events INTEGER NOT NULL DEFAULT 0,
  failed_events INTEGER NOT NULL DEFAULT 0,
  last_event_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  UNIQUE(org_id, email_address)
);

CREATE INDEX email_integrations_org_id_idx ON email_integrations(org_id);
CREATE INDEX email_integrations_enabled_idx ON email_integrations(org_id, enabled) WHERE enabled = true;
