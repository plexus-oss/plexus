-- C1 Stage 0 — port functions + triggers not captured by drizzle-kit introspection.
-- Source of truth: the live (seeded) schema. Intentionally NOT ported:
--   get_org_id() / get_user_id() — RLS helpers, unused now that RLS is gone.

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.upsert_device_schemas(p_org_id text, p_source_id text, p_metrics jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  m JSONB;
BEGIN
  FOR m IN SELECT * FROM jsonb_array_elements(p_metrics)
  LOOP
    INSERT INTO device_schemas (org_id, source_id, metric, value_type, sample_count, min_value, max_value, last_value_at, first_seen_at)
    VALUES (
      p_org_id,
      p_source_id,
      m->>'metric',
      m->>'value_type',
      (m->>'sample_count')::BIGINT,
      (m->>'min_value')::DOUBLE PRECISION,
      (m->>'max_value')::DOUBLE PRECISION,
      NOW(),
      NOW()
    )
    ON CONFLICT (org_id, source_id, metric) DO UPDATE SET
      sample_count = device_schemas.sample_count + EXCLUDED.sample_count,
      min_value = LEAST(device_schemas.min_value, EXCLUDED.min_value),
      max_value = GREATEST(device_schemas.max_value, EXCLUDED.max_value),
      last_value_at = NOW(),
      updated_at = NOW();
  END LOOP;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.increment_share_link_views(link_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE dashboard_share_links
  SET view_count = view_count + 1
  WHERE token = link_token;
END;
$function$;
--> statement-breakpoint
CREATE TRIGGER update_access_overrides_updated_at BEFORE UPDATE ON public.access_overrides FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_alert_rules_updated_at BEFORE UPDATE ON public.alert_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_alerts_updated_at BEFORE UPDATE ON public.alerts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_annotations_updated_at BEFORE UPDATE ON public.annotations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_column_metadata_updated_at BEFORE UPDATE ON public.column_metadata FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_command_definitions_updated_at BEFORE UPDATE ON public.command_definitions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_dashboard_permissions_updated_at BEFORE UPDATE ON public.dashboard_permissions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_dashboard_share_links_updated_at BEFORE UPDATE ON public.dashboard_share_links FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_dashboards_updated_at BEFORE UPDATE ON public.dashboards FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_device_schemas_updated_at BEFORE UPDATE ON public.device_schemas FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_email_integrations_updated_at BEFORE UPDATE ON public.email_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_event_monitors_updated_at BEFORE UPDATE ON public.event_monitors FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_hosted_demos_updated_at BEFORE UPDATE ON public.hosted_demos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_org_billing_updated_at BEFORE UPDATE ON public.org_billing FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_org_members_updated_at BEFORE UPDATE ON public.org_members FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_pagerduty_integrations_updated_at BEFORE UPDATE ON public.pagerduty_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_recordings_updated_at BEFORE UPDATE ON public.recordings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_slack_integrations_updated_at BEFORE UPDATE ON public.slack_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_source_associations_updated_at BEFORE UPDATE ON public.source_associations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_source_context_updated_at BEFORE UPDATE ON public.source_context FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_source_groups_updated_at BEFORE UPDATE ON public.source_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_source_limits_updated_at BEFORE UPDATE ON public.source_limits FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_source_permissions_updated_at BEFORE UPDATE ON public.source_permissions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_sources_updated_at BEFORE UPDATE ON public.sources FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_usage_updated_at BEFORE UPDATE ON public.usage FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_user_notification_state_updated_at BEFORE UPDATE ON public.user_notification_state FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
--> statement-breakpoint
CREATE TRIGGER update_webhooks_updated_at BEFORE UPDATE ON public.webhooks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
