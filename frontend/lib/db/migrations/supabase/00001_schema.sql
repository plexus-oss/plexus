-- Plexus Schema (current production state)
-- Source: pg_dump from production 2026-02-13
-- This file represents the exact current state of the database

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE alert_severity AS ENUM ('critical', 'warning', 'info');
CREATE TYPE alert_status AS ENUM ('open', 'acknowledged', 'resolved');
CREATE TYPE alert_trigger_type AS ENUM ('limit_violation', 'anomaly');
CREATE TYPE annotation_source_type AS ENUM ('device', 'external', 'table');
CREATE TYPE command_delivery_level AS ENUM ('realtime', 'queued', 'scheduled');
CREATE TYPE command_status AS ENUM (
  'created', 'pending_review', 'queued', 'delivering', 'acknowledged',
  'running', 'completed', 'failed', 'timeout', 'cancelled', 'rejected'
);
CREATE TYPE data_source_status AS ENUM ('pending', 'connected', 'error');
CREATE TYPE data_source_type AS ENUM ('postgres', 'clickhouse', 'influxdb', 'mysql');
CREATE TYPE feedback_type AS ENUM ('bug', 'feature', 'general');
CREATE TYPE runbook_status AS ENUM ('draft', 'active', 'archived');
CREATE TYPE session_status AS ENUM ('active', 'completed', 'paused', 'error');
CREATE TYPE share_link_access AS ENUM ('view', 'edit');
CREATE TYPE share_link_status AS ENUM ('active', 'expired', 'revoked');

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION public.get_org_id() RETURNS TEXT AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::json ->> 'org_id',
    (current_setting('request.jwt.claims', true)::json -> 'metadata' ->> 'org_id')
  );
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION public.get_user_id() RETURNS TEXT AS $$
  SELECT current_setting('request.jwt.claims', true)::json ->> 'sub';
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_device_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_source_limits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_webhooks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_share_link_views(link_token TEXT)
RETURNS void AS $$
BEGIN
  UPDATE dashboard_share_links
  SET view_count = view_count + 1
  WHERE token = link_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- TABLES
-- ============================================

-- Sources (unified devices + connections)
CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_seen_at TIMESTAMPTZ,
  last_connected_at TIMESTAMPTZ,
  last_error TEXT,
  device_type TEXT,
  token_hash TEXT,
  connection_type TEXT,
  credentials_encrypted TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  storage_mode TEXT NOT NULL DEFAULT 'none',
  health_score INTEGER,
  tags TEXT[] DEFAULT '{}',
  is_telemetry_store BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT sources_unique_org_slug UNIQUE (org_id, slug),
  CONSTRAINT sources_valid_type CHECK (source_type IN ('device', 'connection', 'recording', 'import')),
  CONSTRAINT sources_valid_status CHECK (status IN ('pending', 'online', 'offline', 'error')),
  CONSTRAINT sources_valid_storage_mode CHECK (storage_mode IN ('none', 'buffered', 'persistent')),
  CONSTRAINT sources_telemetry_store_connection_only CHECK (is_telemetry_store = false OR source_type = 'connection')
);

CREATE INDEX idx_sources_org_id ON sources(org_id);
CREATE INDEX idx_sources_org_type ON sources(org_id, source_type);
CREATE INDEX idx_sources_org_status ON sources(org_id, status);
CREATE INDEX idx_sources_org_slug ON sources(org_id, slug);
CREATE INDEX idx_sources_token_hash ON sources(token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX idx_sources_last_seen ON sources(org_id, last_seen_at DESC NULLS LAST) WHERE source_type = 'device';
CREATE INDEX idx_sources_connection_type ON sources(org_id, connection_type) WHERE source_type = 'connection';
CREATE INDEX sources_tags_idx ON sources USING GIN(tags);
CREATE INDEX sources_health_score_idx ON sources(org_id, health_score);
CREATE INDEX sources_device_type_idx ON sources(org_id, device_type);
CREATE INDEX idx_sources_telemetry_store ON sources(org_id, is_telemetry_store) WHERE is_telemetry_store = true;
CREATE UNIQUE INDEX idx_sources_telemetry_store_unique ON sources(org_id) WHERE is_telemetry_store = true;

-- Sessions
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  name TEXT,
  device_id TEXT,
  source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  status session_status NOT NULL DEFAULT 'active',
  tags JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_org_id ON sessions(org_id);
CREATE INDEX idx_sessions_session_id ON sessions(org_id, session_id);
CREATE INDEX idx_sessions_device_id ON sessions(org_id, device_id);
CREATE INDEX idx_sessions_status ON sessions(org_id, status);
CREATE INDEX idx_sessions_started_at ON sessions(org_id, started_at DESC);
CREATE UNIQUE INDEX idx_sessions_org_session_unique ON sessions(org_id, session_id);
CREATE INDEX idx_sessions_source ON sessions(org_id, source_id);

-- Usage
CREATE TABLE usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  period_start DATE NOT NULL,
  data_points_ingested BIGINT NOT NULL DEFAULT 0,
  bytes_ingested BIGINT NOT NULL DEFAULT 0,
  devices_active INTEGER NOT NULL DEFAULT 0,
  sessions_created INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, period_start)
);

CREATE INDEX idx_usage_org_id ON usage(org_id);
CREATE INDEX idx_usage_period ON usage(org_id, period_start DESC);

CREATE VIEW usage_monthly AS
SELECT
  org_id,
  DATE_TRUNC('month', period_start) as month,
  SUM(data_points_ingested) as total_data_points,
  SUM(bytes_ingested) as total_bytes,
  MAX(devices_active) as peak_devices,
  SUM(sessions_created) as total_sessions
FROM usage
GROUP BY org_id, DATE_TRUNC('month', period_start);

-- API Keys
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT[],
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_keys_org_id ON api_keys(org_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- Dashboards
CREATE TABLE dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  config JSONB NOT NULL,
  parent_id UUID REFERENCES dashboards(id) ON DELETE SET NULL,
  icon TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dashboards_org_id ON dashboards(org_id);
CREATE INDEX idx_dashboards_parent_id ON dashboards(org_id, parent_id);

-- User Settings
CREATE TABLE user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  use_12_hour_format BOOLEAN NOT NULL DEFAULT FALSE,
  recent_commands JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);

-- Plexus Tables (legacy)
CREATE TABLE plexus_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  columns JSONB NOT NULL,
  row_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  source_id UUID REFERENCES sources(id) ON DELETE SET NULL
);

CREATE INDEX idx_plexus_tables_org_id ON plexus_tables(org_id);
CREATE UNIQUE INDEX idx_plexus_tables_org_name ON plexus_tables(org_id, name);
CREATE INDEX idx_plexus_tables_source ON plexus_tables(org_id, source_id);

-- Plexus Table Rows (legacy)
CREATE TABLE plexus_table_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  table_id UUID NOT NULL REFERENCES plexus_tables(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_plexus_table_rows_org_id ON plexus_table_rows(org_id);
CREATE INDEX idx_plexus_table_rows_table_id ON plexus_table_rows(table_id);
CREATE INDEX idx_plexus_table_rows_data ON plexus_table_rows USING GIN(data);

-- Telemetry Limits (legacy, replaced by source_limits)
CREATE TABLE telemetry_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  min DOUBLE PRECISION,
  max DOUBLE PRECISION,
  severity alert_severity NOT NULL DEFAULT 'warning',
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
  UNIQUE(org_id, device_id, metric)
);

CREATE INDEX idx_telemetry_limits_org_id ON telemetry_limits(org_id);
CREATE INDEX idx_telemetry_limits_device ON telemetry_limits(org_id, device_id);
CREATE INDEX idx_telemetry_limits_source ON telemetry_limits(org_id, source_id);

-- Source Context
CREATE TABLE source_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  file_url TEXT,
  file_key TEXT,
  file_size INTEGER,
  mime_type TEXT,
  link_url TEXT,
  content TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT source_context_valid_type CHECK (context_type IN ('file', 'link', 'note')),
  CONSTRAINT source_context_file_has_url CHECK (context_type != 'file' OR (file_url IS NOT NULL AND file_key IS NOT NULL)),
  CONSTRAINT source_context_link_has_url CHECK (context_type != 'link' OR link_url IS NOT NULL),
  CONSTRAINT source_context_note_has_content CHECK (context_type != 'note' OR content IS NOT NULL)
);

CREATE INDEX idx_source_context_org ON source_context(org_id);
CREATE INDEX idx_source_context_source ON source_context(org_id, source_id);
CREATE INDEX idx_source_context_type ON source_context(org_id, source_id, context_type);

-- Source Limits
CREATE TABLE source_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  min DOUBLE PRECISION,
  max DOUBLE PRECISION,
  severity alert_severity NOT NULL DEFAULT 'warning',
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, source_id, metric)
);

CREATE INDEX idx_source_limits_source_id ON source_limits(source_id);
CREATE INDEX idx_source_limits_org_source ON source_limits(org_id, source_id);

-- Markers
CREATE TABLE markers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  label TEXT NOT NULL,
  notes TEXT,
  color TEXT DEFAULT 'amber',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_markers_org_id ON markers(org_id);
CREATE INDEX idx_markers_source ON markers(org_id, source_id);
CREATE INDEX idx_markers_timestamp ON markers(org_id, source_id, timestamp);

-- Marker Comments
CREATE TABLE marker_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  marker_id UUID NOT NULL REFERENCES markers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  mentions JSONB DEFAULT '[]'::jsonb,
  parent_comment_id UUID REFERENCES marker_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_marker_comments_org ON marker_comments(org_id);
CREATE INDEX idx_marker_comments_marker ON marker_comments(marker_id);
CREATE INDEX idx_marker_comments_parent ON marker_comments(parent_comment_id);

-- Dashboard Share Links
CREATE TABLE dashboard_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  name TEXT,
  access_level share_link_access NOT NULL DEFAULT 'view',
  status share_link_status NOT NULL DEFAULT 'active',
  password_hash TEXT,
  expires_at TIMESTAMPTZ,
  max_views INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dashboard_share_links_org_id ON dashboard_share_links(org_id);
CREATE INDEX idx_dashboard_share_links_dashboard_id ON dashboard_share_links(dashboard_id);
CREATE INDEX idx_dashboard_share_links_token ON dashboard_share_links(token);

-- Dashboard Views
CREATE TABLE dashboard_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  share_link_id UUID REFERENCES dashboard_share_links(id) ON DELETE SET NULL,
  viewer_id TEXT,
  session_id TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  referrer TEXT,
  country TEXT,
  city TEXT,
  duration_seconds INTEGER,
  panels_viewed JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dashboard_views_org_id ON dashboard_views(org_id);
CREATE INDEX idx_dashboard_views_dashboard_id ON dashboard_views(dashboard_id);
CREATE INDEX idx_dashboard_views_share_link_id ON dashboard_views(share_link_id);
CREATE INDEX idx_dashboard_views_started_at ON dashboard_views(org_id, started_at);
CREATE INDEX idx_dashboard_views_session_id ON dashboard_views(session_id);

-- Dashboard Permissions
CREATE TABLE dashboard_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  user_id TEXT,
  email TEXT,
  access_level share_link_access NOT NULL DEFAULT 'view',
  invited_by TEXT NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT dashboard_permissions_user_or_email CHECK (user_id IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX idx_dashboard_permissions_org_id ON dashboard_permissions(org_id);
CREATE INDEX idx_dashboard_permissions_dashboard_id ON dashboard_permissions(dashboard_id);
CREATE INDEX idx_dashboard_permissions_user_id ON dashboard_permissions(user_id);
CREATE INDEX idx_dashboard_permissions_email ON dashboard_permissions(email);
CREATE UNIQUE INDEX idx_dashboard_permissions_unique ON dashboard_permissions(dashboard_id, COALESCE(user_id, ''), COALESCE(email, ''));

-- Feedback
CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT,
  user_id TEXT,
  user_email TEXT,
  feedback_type feedback_type NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  page_url TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_feedback_org_id ON feedback(org_id);
CREATE INDEX idx_feedback_user_id ON feedback(user_id);
CREATE INDEX idx_feedback_type ON feedback(feedback_type);
CREATE INDEX idx_feedback_created_at ON feedback(created_at);

-- Alerts
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
  trigger_type alert_trigger_type NOT NULL,
  metric TEXT NOT NULL,
  value NUMERIC NOT NULL,
  threshold NUMERIC,
  bound TEXT,
  severity alert_severity NOT NULL DEFAULT 'warning',
  status alert_status NOT NULL DEFAULT 'open',
  rca TEXT,
  recommended_actions JSONB DEFAULT '[]'::jsonb,
  analysis_confidence NUMERIC,
  analysis_model TEXT,
  analysis_completed_at TIMESTAMPTZ,
  telemetry_snapshot JSONB DEFAULT '[]'::jsonb,
  context_snapshot JSONB DEFAULT '{}'::jsonb,
  limit_id UUID REFERENCES source_limits(id) ON DELETE SET NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  probing_questions JSONB DEFAULT '[]'::jsonb,
  correlated_anomalies JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX alerts_org_id_idx ON alerts(org_id);
CREATE INDEX alerts_source_id_idx ON alerts(source_id);
CREATE INDEX alerts_status_idx ON alerts(status);
CREATE INDEX alerts_severity_idx ON alerts(severity);
CREATE INDEX alerts_triggered_at_idx ON alerts(triggered_at DESC);
CREATE INDEX alerts_org_status_idx ON alerts(org_id, status);
CREATE INDEX alerts_org_triggered_idx ON alerts(org_id, triggered_at DESC);

-- Alert Events
CREATE TABLE alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX alert_events_alert_id_idx ON alert_events(alert_id);
CREATE INDEX alert_events_org_id_idx ON alert_events(org_id);
CREATE INDEX alert_events_created_at_idx ON alert_events(created_at DESC);

-- Source Groups
CREATE TABLE source_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  filter_criteria JSONB DEFAULT '{}'::jsonb,
  static_member_ids UUID[] DEFAULT '{}',
  color TEXT,
  icon TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  source_types TEXT[]
);

CREATE INDEX device_groups_org_id_idx ON source_groups(org_id);
CREATE INDEX device_groups_name_idx ON source_groups(org_id, name);

-- Source Group Commands
CREATE TABLE source_group_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  group_id UUID NOT NULL REFERENCES source_groups(id) ON DELETE CASCADE,
  command_type TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  target_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  results JSONB DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX device_group_commands_org_id_idx ON source_group_commands(org_id);
CREATE INDEX device_group_commands_group_id_idx ON source_group_commands(group_id);
CREATE INDEX device_group_commands_status_idx ON source_group_commands(org_id, status);
CREATE INDEX device_group_commands_created_at_idx ON source_group_commands(org_id, created_at DESC);

-- Webhooks
CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}',
  source_filter JSONB,
  custom_headers JSONB DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  total_deliveries INTEGER NOT NULL DEFAULT 0,
  successful_deliveries INTEGER NOT NULL DEFAULT 0,
  failed_deliveries INTEGER NOT NULL DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX webhooks_org_id_idx ON webhooks(org_id);
CREATE INDEX webhooks_enabled_idx ON webhooks(org_id, enabled);
CREATE INDEX webhooks_events_idx ON webhooks USING GIN(events);

-- Webhook Deliveries
CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
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

CREATE INDEX webhook_deliveries_org_id_idx ON webhook_deliveries(org_id);
CREATE INDEX webhook_deliveries_webhook_id_idx ON webhook_deliveries(webhook_id);
CREATE INDEX webhook_deliveries_status_idx ON webhook_deliveries(org_id, status);
CREATE INDEX webhook_deliveries_event_type_idx ON webhook_deliveries(org_id, event_type);
CREATE INDEX webhook_deliveries_created_at_idx ON webhook_deliveries(org_id, created_at DESC);
CREATE INDEX webhook_deliveries_pending_retry_idx ON webhook_deliveries(status, next_retry_at)
  WHERE status = 'pending' OR status = 'retrying';

-- Slack Integrations
CREATE TABLE slack_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  webhook_url_encrypted TEXT NOT NULL,
  access_token_encrypted TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  events TEXT[] NOT NULL DEFAULT ARRAY['alert.triggered', 'device.offline']::TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  UNIQUE(org_id, team_id, channel_id)
);

CREATE INDEX slack_integrations_org_id_idx ON slack_integrations(org_id);
CREATE INDEX slack_integrations_team_id_idx ON slack_integrations(team_id);
CREATE INDEX slack_integrations_enabled_idx ON slack_integrations(org_id, enabled) WHERE enabled = true;

-- Slack OAuth States
CREATE TABLE slack_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  state TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '10 minutes'
);

CREATE INDEX slack_oauth_states_state_idx ON slack_oauth_states(state);
CREATE INDEX slack_oauth_states_expires_idx ON slack_oauth_states(expires_at);

-- PagerDuty Integrations
CREATE TABLE pagerduty_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  service_name TEXT NOT NULL,
  routing_key_encrypted TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  events TEXT[] NOT NULL DEFAULT ARRAY['alert.triggered', 'threshold.critical']::TEXT[],
  default_severity TEXT NOT NULL DEFAULT 'critical',
  auto_resolve BOOLEAN NOT NULL DEFAULT true,
  total_events INTEGER NOT NULL DEFAULT 0,
  successful_events INTEGER NOT NULL DEFAULT 0,
  failed_events INTEGER NOT NULL DEFAULT 0,
  last_event_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  UNIQUE(org_id, name)
);

CREATE INDEX pagerduty_integrations_org_id_idx ON pagerduty_integrations(org_id);
CREATE INDEX pagerduty_integrations_enabled_idx ON pagerduty_integrations(org_id, enabled) WHERE enabled = true;

-- System Events
CREATE TABLE system_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  source_id UUID,
  source_name TEXT,
  source_slug TEXT,
  entity_id TEXT,
  entity_type TEXT,
  actor_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(source_name, '')), 'C')
  ) STORED
);

CREATE INDEX idx_system_events_org_created ON system_events(org_id, created_at DESC);
CREATE INDEX idx_system_events_org_type ON system_events(org_id, event_type, created_at DESC);
CREATE INDEX idx_system_events_org_category ON system_events(org_id, category, created_at DESC);
CREATE INDEX idx_system_events_org_severity ON system_events(org_id, severity, created_at DESC);
CREATE INDEX idx_system_events_org_source ON system_events(org_id, source_id, created_at DESC);
CREATE INDEX idx_system_events_search ON system_events USING GIN(search_vector);

-- Runbooks
CREATE TABLE runbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status runbook_status NOT NULL DEFAULT 'draft',
  steps JSONB DEFAULT '[]'::jsonb,
  source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
  tags TEXT[] DEFAULT '{}',
  last_run_at TIMESTAMPTZ,
  last_run_by TEXT,
  run_count INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX runbooks_org_id_idx ON runbooks(org_id);
CREATE INDEX runbooks_status_idx ON runbooks(status);
CREATE INDEX runbooks_source_id_idx ON runbooks(source_id);
CREATE INDEX runbooks_org_status_idx ON runbooks(org_id, status);
CREATE INDEX runbooks_org_updated_idx ON runbooks(org_id, updated_at DESC);

-- Commands
CREATE TABLE commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  status command_status NOT NULL DEFAULT 'created',
  delivery_level command_delivery_level NOT NULL DEFAULT 'realtime',
  hazardous BOOLEAN DEFAULT FALSE,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  exit_code INTEGER,
  error TEXT,
  output_lines INTEGER DEFAULT 0,
  output TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  queued_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  timeout_seconds INTEGER DEFAULT 300,
  priority INTEGER DEFAULT 0,
  sequence_id UUID,
  sequence_order INTEGER,
  created_by TEXT,
  runbook_id UUID REFERENCES runbooks(id) ON DELETE SET NULL,
  runbook_step_index INTEGER,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX commands_org_id_idx ON commands(org_id);
CREATE INDEX commands_source_id_idx ON commands(source_id);
CREATE INDEX commands_status_idx ON commands(status);
CREATE INDEX commands_org_source_idx ON commands(org_id, source_id, created_at DESC);
CREATE INDEX commands_queued_idx ON commands(source_id, status, priority DESC)
  WHERE status IN ('queued', 'delivering');
CREATE INDEX commands_sequence_idx ON commands(sequence_id, sequence_order)
  WHERE sequence_id IS NOT NULL;

-- Device Auth Requests
CREATE TABLE device_auth_requests (
  device_code TEXT PRIMARY KEY,
  user_code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  org_id TEXT,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_device_auth_user_code ON device_auth_requests(user_code);
CREATE INDEX idx_device_auth_expires ON device_auth_requests(expires_at);

-- Command Policies
CREATE TABLE command_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
  allowed_commands TEXT[] NOT NULL DEFAULT '{}',
  denied_commands TEXT[] NOT NULL DEFAULT '{}',
  require_approval BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  CONSTRAINT unique_org_source_policy UNIQUE (org_id, source_id)
);

CREATE INDEX idx_command_policies_org ON command_policies(org_id);
CREATE UNIQUE INDEX idx_command_policies_org_default ON command_policies(org_id) WHERE source_id IS NULL;

-- Test Sessions
CREATE TABLE test_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  pass_criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  result JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_test_sessions_org ON test_sessions(org_id);
CREATE INDEX idx_test_sessions_source ON test_sessions(org_id, source_id);
CREATE INDEX idx_test_sessions_status ON test_sessions(org_id, status);

-- Insights
CREATE TABLE insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  dismissed BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_insights_org ON insights(org_id);
CREATE INDEX idx_insights_source ON insights(org_id, source_id);
CREATE INDEX idx_insights_active ON insights(org_id, dismissed) WHERE dismissed = false;

-- ============================================
-- ROW LEVEL SECURITY (as currently deployed)
-- ============================================

ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE plexus_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE plexus_table_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE marker_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_group_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagerduty_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE runbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_auth_requests ENABLE ROW LEVEL SECURITY;

-- Tables using get_org_id() pattern
CREATE POLICY "sources_org_isolation" ON sources FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "sources_service_role" ON sources FOR ALL TO service_role USING (true);
CREATE POLICY "sessions_org_isolation" ON sessions FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "sessions_service_role" ON sessions FOR ALL TO service_role USING (true);
CREATE POLICY "usage_org_isolation" ON usage FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "usage_service_role" ON usage FOR ALL TO service_role USING (true);
CREATE POLICY "api_keys_org_isolation" ON api_keys FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "api_keys_service_role" ON api_keys FOR ALL TO service_role USING (true);
CREATE POLICY "dashboards_org_isolation" ON dashboards FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "dashboards_service_role" ON dashboards FOR ALL TO service_role USING (true);
CREATE POLICY "user_settings_user_isolation" ON user_settings FOR ALL USING (user_id = public.get_user_id());
CREATE POLICY "user_settings_service_role" ON user_settings FOR ALL TO service_role USING (true);
CREATE POLICY "plexus_tables_org_isolation" ON plexus_tables FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "plexus_tables_service_role" ON plexus_tables FOR ALL TO service_role USING (true);
CREATE POLICY "plexus_table_rows_org_isolation" ON plexus_table_rows FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "plexus_table_rows_service_role" ON plexus_table_rows FOR ALL TO service_role USING (true);
CREATE POLICY "telemetry_limits_org_isolation" ON telemetry_limits FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "telemetry_limits_service_role" ON telemetry_limits FOR ALL TO service_role USING (true);
CREATE POLICY "source_context_org_isolation" ON source_context FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "source_context_service_role" ON source_context FOR ALL TO service_role USING (true);
CREATE POLICY "markers_org_isolation" ON markers FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "markers_service_role" ON markers FOR ALL TO service_role USING (true);
CREATE POLICY "dashboard_share_links_org_isolation" ON dashboard_share_links FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "dashboard_share_links_service_role" ON dashboard_share_links FOR ALL TO service_role USING (true);
CREATE POLICY "dashboard_views_org_isolation" ON dashboard_views FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "dashboard_views_service_role" ON dashboard_views FOR ALL TO service_role USING (true);
CREATE POLICY "dashboard_permissions_org_isolation" ON dashboard_permissions FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "dashboard_permissions_service_role" ON dashboard_permissions FOR ALL TO service_role USING (true);

-- Feedback: anyone can insert, org-scoped reads
CREATE POLICY "feedback_insert_all" ON feedback FOR INSERT WITH CHECK (true);
CREATE POLICY "feedback_org_isolation" ON feedback FOR SELECT USING (org_id = public.get_org_id());
CREATE POLICY "feedback_service_role" ON feedback FOR ALL TO service_role USING (true);

-- Tables using current_setting('request.jwt.claims') pattern
CREATE POLICY "Users can view alerts in their org" ON alerts FOR SELECT
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "Users can insert alerts in their org" ON alerts FOR INSERT
  WITH CHECK (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "Users can update alerts in their org" ON alerts FOR UPDATE
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "Users can delete alerts in their org" ON alerts FOR DELETE
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));

CREATE POLICY "Users can view alert events in their org" ON alert_events FOR SELECT
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "Users can insert alert events in their org" ON alert_events FOR INSERT
  WITH CHECK (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));

CREATE POLICY "Users can view runbooks in their org" ON runbooks FOR SELECT
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "Users can insert runbooks in their org" ON runbooks FOR INSERT
  WITH CHECK (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "Users can update runbooks in their org" ON runbooks FOR UPDATE
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "Users can delete runbooks in their org" ON runbooks FOR DELETE
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));

CREATE POLICY "Users can view commands in their org" ON commands FOR SELECT
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "Users can insert commands in their org" ON commands FOR INSERT
  WITH CHECK (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "Users can update commands in their org" ON commands FOR UPDATE
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "Users can delete commands in their org" ON commands FOR DELETE
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));

CREATE POLICY "Users can view their org policies" ON command_policies FOR SELECT
  USING (org_id = current_setting('request.jwt.claims', true)::json->>'org_id');
CREATE POLICY "Users can insert their org policies" ON command_policies FOR INSERT
  WITH CHECK (org_id = current_setting('request.jwt.claims', true)::json->>'org_id');
CREATE POLICY "Users can update their org policies" ON command_policies FOR UPDATE
  USING (org_id = current_setting('request.jwt.claims', true)::json->>'org_id');
CREATE POLICY "Users can delete their org policies" ON command_policies FOR DELETE
  USING (org_id = current_setting('request.jwt.claims', true)::json->>'org_id');

-- Source groups/commands using current_setting pattern
CREATE POLICY "source_groups_org_isolation" ON source_groups FOR SELECT
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "source_groups_org_insert" ON source_groups FOR INSERT
  WITH CHECK (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "source_groups_org_update" ON source_groups FOR UPDATE
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "source_groups_org_delete" ON source_groups FOR DELETE
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "source_group_commands_org_isolation" ON source_group_commands FOR SELECT
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "source_group_commands_org_insert" ON source_group_commands FOR INSERT
  WITH CHECK (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));
CREATE POLICY "source_group_commands_org_update" ON source_group_commands FOR UPDATE
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id'));

-- Tables using auth.jwt() pattern
CREATE POLICY "org_isolation" ON source_limits
  FOR ALL USING (org_id = auth.jwt() ->> 'org_id') WITH CHECK (org_id = auth.jwt() ->> 'org_id');
CREATE POLICY "service_role_all" ON source_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Users can view their org's device groups" ON source_groups FOR SELECT
  USING (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can insert device groups for their org" ON source_groups FOR INSERT
  WITH CHECK (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can update their org's device groups" ON source_groups FOR UPDATE
  USING (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can delete their org's device groups" ON source_groups FOR DELETE
  USING (auth.jwt() ->> 'org_id' = org_id);

CREATE POLICY "Users can view their org's group commands" ON source_group_commands FOR SELECT
  USING (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can insert group commands for their org" ON source_group_commands FOR INSERT
  WITH CHECK (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can update their org's group commands" ON source_group_commands FOR UPDATE
  USING (auth.jwt() ->> 'org_id' = org_id);

CREATE POLICY "Users can view their org's webhooks" ON webhooks FOR SELECT
  USING (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can insert webhooks for their org" ON webhooks FOR INSERT
  WITH CHECK (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can update their org's webhooks" ON webhooks FOR UPDATE
  USING (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can delete their org's webhooks" ON webhooks FOR DELETE
  USING (auth.jwt() ->> 'org_id' = org_id);

CREATE POLICY "Users can view their org's webhook deliveries" ON webhook_deliveries FOR SELECT
  USING (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can insert webhook deliveries for their org" ON webhook_deliveries FOR INSERT
  WITH CHECK (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can update their org's webhook deliveries" ON webhook_deliveries FOR UPDATE
  USING (auth.jwt() ->> 'org_id' = org_id);

CREATE POLICY "Users can view their org's slack integrations" ON slack_integrations FOR SELECT
  USING (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can create slack integrations for their org" ON slack_integrations FOR INSERT
  WITH CHECK (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can update their org's slack integrations" ON slack_integrations FOR UPDATE
  USING (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can delete their org's slack integrations" ON slack_integrations FOR DELETE
  USING (auth.jwt() ->> 'org_id' = org_id);

CREATE POLICY "Users can manage their own oauth states" ON slack_oauth_states
  FOR ALL USING (auth.jwt() ->> 'org_id' = org_id);

CREATE POLICY "Users can view their org's pagerduty integrations" ON pagerduty_integrations FOR SELECT
  USING (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can create pagerduty integrations for their org" ON pagerduty_integrations FOR INSERT
  WITH CHECK (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can update their org's pagerduty integrations" ON pagerduty_integrations FOR UPDATE
  USING (auth.jwt() ->> 'org_id' = org_id);
CREATE POLICY "Users can delete their org's pagerduty integrations" ON pagerduty_integrations FOR DELETE
  USING (auth.jwt() ->> 'org_id' = org_id);

-- System events: org-scoped reads, open inserts
CREATE POLICY "Users can view their org system events" ON system_events FOR SELECT
  USING (org_id = auth.jwt() ->> 'org_id');
CREATE POLICY "Service role can insert system events" ON system_events FOR INSERT
  WITH CHECK (true);

-- Marker comments: org-scoped
CREATE POLICY "marker_comments_org_isolation" ON marker_comments
  FOR ALL USING (org_id = current_setting('app.org_id', true));
CREATE POLICY "marker_comments_service_role" ON marker_comments
  FOR ALL USING (current_setting('role', true) = 'service_role');

-- Test sessions: org-scoped
CREATE POLICY "test_sessions_org_isolation" ON test_sessions
  FOR ALL USING (org_id = current_setting('app.org_id', true));
CREATE POLICY "test_sessions_service_role" ON test_sessions
  FOR ALL USING (current_setting('role', true) = 'service_role');

-- Insights: org-scoped
CREATE POLICY "insights_org_isolation" ON insights
  FOR ALL USING (org_id = current_setting('app.org_id', true));
CREATE POLICY "insights_service_role" ON insights
  FOR ALL USING (current_setting('role', true) = 'service_role');

-- ============================================
-- TRIGGERS (as currently deployed)
-- ============================================

CREATE TRIGGER update_sources_updated_at BEFORE UPDATE ON sources FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_usage_updated_at BEFORE UPDATE ON usage FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_dashboards_updated_at BEFORE UPDATE ON dashboards FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON user_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_plexus_tables_updated_at BEFORE UPDATE ON plexus_tables FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_plexus_table_rows_updated_at BEFORE UPDATE ON plexus_table_rows FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_telemetry_limits_updated_at BEFORE UPDATE ON telemetry_limits FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_source_context_updated_at BEFORE UPDATE ON source_context FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER source_limits_updated_at BEFORE UPDATE ON source_limits FOR EACH ROW EXECUTE FUNCTION update_source_limits_updated_at();
CREATE TRIGGER update_markers_updated_at BEFORE UPDATE ON markers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_marker_comments_updated_at BEFORE UPDATE ON marker_comments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_dashboard_share_links_updated_at BEFORE UPDATE ON dashboard_share_links FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_dashboard_permissions_updated_at BEFORE UPDATE ON dashboard_permissions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_alerts_updated_at BEFORE UPDATE ON alerts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER device_groups_updated_at BEFORE UPDATE ON source_groups FOR EACH ROW EXECUTE FUNCTION update_device_groups_updated_at();
CREATE TRIGGER webhooks_updated_at BEFORE UPDATE ON webhooks FOR EACH ROW EXECUTE FUNCTION update_webhooks_updated_at();
CREATE TRIGGER slack_integrations_updated_at BEFORE UPDATE ON slack_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER pagerduty_integrations_updated_at BEFORE UPDATE ON pagerduty_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_runbooks_updated_at BEFORE UPDATE ON runbooks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_commands_updated_at BEFORE UPDATE ON commands FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_command_policies_updated_at BEFORE UPDATE ON command_policies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_test_sessions_updated_at BEFORE UPDATE ON test_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
