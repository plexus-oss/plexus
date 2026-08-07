-- Schema Cleanup Migration
-- Run on production to fix inconsistencies accumulated over 38 migrations
--
-- What this does:
-- 1. Drop legacy tables (telemetry_limits, plexus_tables, plexus_table_rows)
-- 2. Drop unused enums (data_source_type, data_source_status, annotation_source_type)
-- 3. Standardize ALL RLS policies to use public.get_org_id()
-- 4. Add missing service_role bypass policies
-- 5. Consolidate duplicate trigger functions into update_updated_at()

-- ============================================
-- 1. DROP LEGACY TABLES
-- ============================================

-- Drop triggers first
DROP TRIGGER IF EXISTS update_telemetry_limits_updated_at ON telemetry_limits;
DROP TRIGGER IF EXISTS update_plexus_table_rows_updated_at ON plexus_table_rows;
DROP TRIGGER IF EXISTS update_plexus_tables_updated_at ON plexus_tables;

-- Drop RLS policies
DROP POLICY IF EXISTS "telemetry_limits_org_isolation" ON telemetry_limits;
DROP POLICY IF EXISTS "telemetry_limits_service_role" ON telemetry_limits;
DROP POLICY IF EXISTS "plexus_table_rows_org_isolation" ON plexus_table_rows;
DROP POLICY IF EXISTS "plexus_table_rows_service_role" ON plexus_table_rows;
DROP POLICY IF EXISTS "plexus_tables_org_isolation" ON plexus_tables;
DROP POLICY IF EXISTS "plexus_tables_service_role" ON plexus_tables;

-- Drop tables (plexus_table_rows first due to FK)
DROP TABLE IF EXISTS plexus_table_rows CASCADE;
DROP TABLE IF EXISTS plexus_tables CASCADE;
DROP TABLE IF EXISTS telemetry_limits CASCADE;

-- ============================================
-- 2. DROP UNUSED ENUMS
-- ============================================

DROP TYPE IF EXISTS data_source_type;
DROP TYPE IF EXISTS data_source_status;
DROP TYPE IF EXISTS annotation_source_type;

-- ============================================
-- 3. FIX RLS: source_limits (auth.jwt() -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "org_isolation" ON source_limits;
DROP POLICY IF EXISTS "service_role_all" ON source_limits;

CREATE POLICY "source_limits_org_isolation" ON source_limits
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "source_limits_service_role" ON source_limits
  FOR ALL TO service_role USING (true);

-- ============================================
-- 4. FIX RLS: alerts (current_setting -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "Users can view alerts in their org" ON alerts;
DROP POLICY IF EXISTS "Users can insert alerts in their org" ON alerts;
DROP POLICY IF EXISTS "Users can update alerts in their org" ON alerts;
DROP POLICY IF EXISTS "Users can delete alerts in their org" ON alerts;

CREATE POLICY "alerts_org_isolation" ON alerts
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "alerts_service_role" ON alerts
  FOR ALL TO service_role USING (true);

-- ============================================
-- 5. FIX RLS: alert_events (current_setting -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "Users can view alert events in their org" ON alert_events;
DROP POLICY IF EXISTS "Users can insert alert events in their org" ON alert_events;

CREATE POLICY "alert_events_org_isolation" ON alert_events
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "alert_events_service_role" ON alert_events
  FOR ALL TO service_role USING (true);

-- ============================================
-- 6. FIX RLS: runbooks (current_setting -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "Users can view runbooks in their org" ON runbooks;
DROP POLICY IF EXISTS "Users can insert runbooks in their org" ON runbooks;
DROP POLICY IF EXISTS "Users can update runbooks in their org" ON runbooks;
DROP POLICY IF EXISTS "Users can delete runbooks in their org" ON runbooks;

CREATE POLICY "runbooks_org_isolation" ON runbooks
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "runbooks_service_role" ON runbooks
  FOR ALL TO service_role USING (true);

-- ============================================
-- 7. FIX RLS: commands (current_setting -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "Users can view commands in their org" ON commands;
DROP POLICY IF EXISTS "Users can insert commands in their org" ON commands;
DROP POLICY IF EXISTS "Users can update commands in their org" ON commands;
DROP POLICY IF EXISTS "Users can delete commands in their org" ON commands;

CREATE POLICY "commands_org_isolation" ON commands
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "commands_service_role" ON commands
  FOR ALL TO service_role USING (true);

-- ============================================
-- 8. FIX RLS: command_policies (current_setting -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "Users can view their org policies" ON command_policies;
DROP POLICY IF EXISTS "Users can insert their org policies" ON command_policies;
DROP POLICY IF EXISTS "Users can update their org policies" ON command_policies;
DROP POLICY IF EXISTS "Users can delete their org policies" ON command_policies;

CREATE POLICY "command_policies_org_isolation" ON command_policies
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "command_policies_service_role" ON command_policies
  FOR ALL TO service_role USING (true);

-- ============================================
-- 9. FIX RLS: source_groups (mixed auth.jwt + current_setting -> get_org_id())
-- ============================================

-- Drop current_setting policies
DROP POLICY IF EXISTS "source_groups_org_isolation" ON source_groups;
DROP POLICY IF EXISTS "source_groups_org_insert" ON source_groups;
DROP POLICY IF EXISTS "source_groups_org_update" ON source_groups;
DROP POLICY IF EXISTS "source_groups_org_delete" ON source_groups;
-- Drop auth.jwt() policies
DROP POLICY IF EXISTS "Users can view their org's device groups" ON source_groups;
DROP POLICY IF EXISTS "Users can insert device groups for their org" ON source_groups;
DROP POLICY IF EXISTS "Users can update their org's device groups" ON source_groups;
DROP POLICY IF EXISTS "Users can delete their org's device groups" ON source_groups;

CREATE POLICY "source_groups_org_isolation" ON source_groups
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "source_groups_service_role" ON source_groups
  FOR ALL TO service_role USING (true);

-- ============================================
-- 10. FIX RLS: source_group_commands (mixed -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "source_group_commands_org_isolation" ON source_group_commands;
DROP POLICY IF EXISTS "source_group_commands_org_insert" ON source_group_commands;
DROP POLICY IF EXISTS "source_group_commands_org_update" ON source_group_commands;
DROP POLICY IF EXISTS "Users can view their org's group commands" ON source_group_commands;
DROP POLICY IF EXISTS "Users can insert group commands for their org" ON source_group_commands;
DROP POLICY IF EXISTS "Users can update their org's group commands" ON source_group_commands;

CREATE POLICY "source_group_commands_org_isolation" ON source_group_commands
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "source_group_commands_service_role" ON source_group_commands
  FOR ALL TO service_role USING (true);

-- ============================================
-- 11. FIX RLS: webhooks (auth.jwt() -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "Users can view their org's webhooks" ON webhooks;
DROP POLICY IF EXISTS "Users can insert webhooks for their org" ON webhooks;
DROP POLICY IF EXISTS "Users can update their org's webhooks" ON webhooks;
DROP POLICY IF EXISTS "Users can delete their org's webhooks" ON webhooks;

CREATE POLICY "webhooks_org_isolation" ON webhooks
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "webhooks_service_role" ON webhooks
  FOR ALL TO service_role USING (true);

-- ============================================
-- 12. FIX RLS: webhook_deliveries (auth.jwt() -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "Users can view their org's webhook deliveries" ON webhook_deliveries;
DROP POLICY IF EXISTS "Users can insert webhook deliveries for their org" ON webhook_deliveries;
DROP POLICY IF EXISTS "Users can update their org's webhook deliveries" ON webhook_deliveries;

CREATE POLICY "webhook_deliveries_org_isolation" ON webhook_deliveries
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "webhook_deliveries_service_role" ON webhook_deliveries
  FOR ALL TO service_role USING (true);

-- ============================================
-- 13. FIX RLS: slack_integrations (auth.jwt() -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "Users can view their org's slack integrations" ON slack_integrations;
DROP POLICY IF EXISTS "Users can create slack integrations for their org" ON slack_integrations;
DROP POLICY IF EXISTS "Users can update their org's slack integrations" ON slack_integrations;
DROP POLICY IF EXISTS "Users can delete their org's slack integrations" ON slack_integrations;

CREATE POLICY "slack_integrations_org_isolation" ON slack_integrations
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "slack_integrations_service_role" ON slack_integrations
  FOR ALL TO service_role USING (true);

-- ============================================
-- 14. FIX RLS: slack_oauth_states (auth.jwt() -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "Users can manage their own oauth states" ON slack_oauth_states;

CREATE POLICY "slack_oauth_states_org_isolation" ON slack_oauth_states
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "slack_oauth_states_service_role" ON slack_oauth_states
  FOR ALL TO service_role USING (true);

-- ============================================
-- 15. FIX RLS: pagerduty_integrations (auth.jwt() -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "Users can view their org's pagerduty integrations" ON pagerduty_integrations;
DROP POLICY IF EXISTS "Users can create pagerduty integrations for their org" ON pagerduty_integrations;
DROP POLICY IF EXISTS "Users can update their org's pagerduty integrations" ON pagerduty_integrations;
DROP POLICY IF EXISTS "Users can delete their org's pagerduty integrations" ON pagerduty_integrations;

CREATE POLICY "pagerduty_integrations_org_isolation" ON pagerduty_integrations
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "pagerduty_integrations_service_role" ON pagerduty_integrations
  FOR ALL TO service_role USING (true);

-- ============================================
-- 16. FIX RLS: system_events (auth.jwt() -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "Users can view their org system events" ON system_events;
DROP POLICY IF EXISTS "Service role can insert system events" ON system_events;

CREATE POLICY "system_events_org_select" ON system_events
  FOR SELECT USING (org_id = public.get_org_id());
CREATE POLICY "system_events_service_role" ON system_events
  FOR ALL TO service_role USING (true);

-- ============================================
-- 17. FIX RLS: marker_comments (broken app.org_id -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "marker_comments_org_isolation" ON marker_comments;
DROP POLICY IF EXISTS "marker_comments_service_role" ON marker_comments;

CREATE POLICY "marker_comments_org_isolation" ON marker_comments
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "marker_comments_service_role" ON marker_comments
  FOR ALL TO service_role USING (true);

-- ============================================
-- 18. FIX RLS: test_sessions (broken app.org_id -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "test_sessions_org_isolation" ON test_sessions;
DROP POLICY IF EXISTS "test_sessions_service_role" ON test_sessions;

CREATE POLICY "test_sessions_org_isolation" ON test_sessions
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "test_sessions_service_role" ON test_sessions
  FOR ALL TO service_role USING (true);

-- ============================================
-- 19. FIX RLS: insights (broken app.org_id -> get_org_id())
-- ============================================

DROP POLICY IF EXISTS "insights_org_isolation" ON insights;
DROP POLICY IF EXISTS "insights_service_role" ON insights;

CREATE POLICY "insights_org_isolation" ON insights
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "insights_service_role" ON insights
  FOR ALL TO service_role USING (true);

-- ============================================
-- 20. CONSOLIDATE TRIGGER FUNCTIONS
-- ============================================

-- Replace all duplicate trigger functions with update_updated_at()

-- source_limits: swap trigger function
DROP TRIGGER IF EXISTS source_limits_updated_at ON source_limits;
CREATE TRIGGER update_source_limits_updated_at
  BEFORE UPDATE ON source_limits FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- alerts: swap trigger function
DROP TRIGGER IF EXISTS set_alerts_updated_at ON alerts;
CREATE TRIGGER update_alerts_updated_at
  BEFORE UPDATE ON alerts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- source_groups: swap trigger function
DROP TRIGGER IF EXISTS device_groups_updated_at ON source_groups;
CREATE TRIGGER update_source_groups_updated_at
  BEFORE UPDATE ON source_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- webhooks: swap trigger function
DROP TRIGGER IF EXISTS webhooks_updated_at ON webhooks;
CREATE TRIGGER update_webhooks_updated_at
  BEFORE UPDATE ON webhooks FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- slack_integrations: swap trigger function
DROP TRIGGER IF EXISTS slack_integrations_updated_at ON slack_integrations;
CREATE TRIGGER update_slack_integrations_updated_at
  BEFORE UPDATE ON slack_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- pagerduty_integrations: swap trigger function
DROP TRIGGER IF EXISTS pagerduty_integrations_updated_at ON pagerduty_integrations;
CREATE TRIGGER update_pagerduty_integrations_updated_at
  BEFORE UPDATE ON pagerduty_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- runbooks: swap trigger function
DROP TRIGGER IF EXISTS set_runbooks_updated_at ON runbooks;
CREATE TRIGGER update_runbooks_updated_at
  BEFORE UPDATE ON runbooks FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- commands: swap trigger function
DROP TRIGGER IF EXISTS set_commands_updated_at ON commands;
CREATE TRIGGER update_commands_updated_at
  BEFORE UPDATE ON commands FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- command_policies: swap trigger function
DROP TRIGGER IF EXISTS set_command_policies_updated_at ON command_policies;
CREATE TRIGGER update_command_policies_updated_at
  BEFORE UPDATE ON command_policies FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Drop the now-unused duplicate trigger functions
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS update_device_groups_updated_at();
DROP FUNCTION IF EXISTS update_source_limits_updated_at();
DROP FUNCTION IF EXISTS update_webhooks_updated_at();
