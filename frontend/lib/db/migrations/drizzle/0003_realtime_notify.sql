-- Custom SQL migration file, put your code below! --
-- C2 Track 2 — Postgres LISTEN/NOTIFY for browser realtime (replaces Supabase Realtime).
--
-- A generic AFTER trigger emits a small NOTIFY on 'row_change' for every
-- insert/update/delete on the app tables the frontend watches. The Next SSE
-- endpoint (app/api/realtime/stream) holds one LISTEN connection and fans the
-- events to browsers, filtered by org_id. Payload stays tiny (table/op/org_id/id)
-- — well under Postgres' 8000-byte NOTIFY limit — so the client refetches via the
-- normal API rather than receiving row contents.
--
-- org_id/id are pulled from to_jsonb(row) so the one function works across tables
-- regardless of their exact columns (and is null-safe if a column is absent).

CREATE OR REPLACE FUNCTION public.notify_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  rec JSONB;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    rec := to_jsonb(OLD);
  ELSE
    rec := to_jsonb(NEW);
  END IF;
  PERFORM pg_notify(
    'row_change',
    json_build_object(
      'table', TG_TABLE_NAME,
      'op', TG_OP,
      'org_id', rec->>'org_id',
      'id', rec->>'id'
    )::text
  );
  RETURN NULL;
END;
$function$;
--> statement-breakpoint
CREATE TRIGGER notify_alerts_change AFTER INSERT OR UPDATE OR DELETE ON public.alerts FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();
--> statement-breakpoint
CREATE TRIGGER notify_event_monitors_change AFTER INSERT OR UPDATE OR DELETE ON public.event_monitors FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();
--> statement-breakpoint
CREATE TRIGGER notify_dashboards_change AFTER INSERT OR UPDATE OR DELETE ON public.dashboards FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();
--> statement-breakpoint
CREATE TRIGGER notify_sources_change AFTER INSERT OR UPDATE OR DELETE ON public.sources FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();
--> statement-breakpoint
CREATE TRIGGER notify_annotations_change AFTER INSERT OR UPDATE OR DELETE ON public.annotations FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();
--> statement-breakpoint
CREATE TRIGGER notify_api_keys_change AFTER INSERT OR UPDATE OR DELETE ON public.api_keys FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();
--> statement-breakpoint
CREATE TRIGGER notify_source_limits_change AFTER INSERT OR UPDATE OR DELETE ON public.source_limits FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();
--> statement-breakpoint
CREATE TRIGGER notify_system_events_change AFTER INSERT OR UPDATE OR DELETE ON public.system_events FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();