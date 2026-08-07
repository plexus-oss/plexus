-- Source identity normalization: event_monitors.source_id becomes a real uuid
-- FK (matching source_limits), and legacy alert_rules rows that still hold
-- UUID strings from the pre-00037 cast are rewritten to slugs. Backfills are
-- no-ops on empty tables, so fresh (test) databases apply cleanly.

-- 1) Backfill slug-valued event_monitors rows to the source UUID (org-scoped).
UPDATE event_monitors em SET source_id = s.id::text
FROM sources s
WHERE em.source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND s.org_id = em.org_id AND s.slug = em.source_id;--> statement-breakpoint

-- 2) Drop rows that resolve to no source. These are already invisible: the
--    poll loop inner-joins on sources.id, so they can never fire.
DELETE FROM event_monitors em
WHERE NOT EXISTS (SELECT 1 FROM sources s WHERE s.id::text = em.source_id);--> statement-breakpoint

-- 3) Type change + FK cascade (fixes orphaned monitors on source delete).
ALTER TABLE "event_monitors" ALTER COLUMN "source_id" SET DATA TYPE uuid USING source_id::uuid;--> statement-breakpoint
ALTER TABLE "event_monitors" ADD CONSTRAINT "event_monitors_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- 4) alert_rules stores the SLUG (00037), but its ALTER ... TYPE TEXT cast
--    preserved UUID values on pre-00037 rows; those can never match a
--    slug-keyed telemetry envelope. Rewrite them to the slug. Guard: never
--    touch a value that is a real slug in this org (uuid-shaped slugs exist
--    in theory; creation now rejects them, but old rows are sacred).
UPDATE alert_rules ar SET source_id = s.slug
FROM sources s
WHERE ar.source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND s.id::text = ar.source_id AND s.org_id = ar.org_id
  AND NOT EXISTS (SELECT 1 FROM sources s2
                  WHERE s2.org_id = ar.org_id AND s2.slug = ar.source_id);
