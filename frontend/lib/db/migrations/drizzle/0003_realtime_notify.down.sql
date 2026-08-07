-- Manual rollback for 0003_realtime_notify.sql (Drizzle has no down-migrations).
-- Removes the realtime NOTIFY triggers + function. Safe and additive-reverse:
-- the app degrades to "no live updates" — nothing else depends on these.
--
--   psql "$DATABASE_URL" -f lib/db/migrations/drizzle/0003_realtime_notify.down.sql
--
-- If you want `db:migrate` to RE-APPLY 0003 afterward, also delete its ledger row
-- (otherwise the migrator still considers it applied):
--   DELETE FROM "drizzle"."__drizzle_migrations" WHERE created_at = <0003 folderMillis>;

DROP TRIGGER IF EXISTS notify_alerts_change ON public.alerts;
DROP TRIGGER IF EXISTS notify_event_monitors_change ON public.event_monitors;
DROP TRIGGER IF EXISTS notify_dashboards_change ON public.dashboards;
DROP TRIGGER IF EXISTS notify_sources_change ON public.sources;
DROP TRIGGER IF EXISTS notify_annotations_change ON public.annotations;
DROP TRIGGER IF EXISTS notify_api_keys_change ON public.api_keys;
DROP TRIGGER IF EXISTS notify_source_limits_change ON public.source_limits;
DROP TRIGGER IF EXISTS notify_system_events_change ON public.system_events;

DROP FUNCTION IF EXISTS public.notify_row_change();
