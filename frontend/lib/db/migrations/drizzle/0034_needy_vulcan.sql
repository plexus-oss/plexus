-- Alert close-out: backfill the two-lifecycle drift, then add the limit-alert
-- dedup index. Context: `status` (user workflow) and `is_alert_active`/
-- `closed_at` (machine condition) diverged because no code path updated both.
-- From this migration's release on: a machine close also resolves status, a
-- manual resolve also clears the machine fields, and poll-path limit alerts
-- are created active with this index as their durable dedup.
-- Every statement is idempotent — safe to re-run.

-- A. Machine-closed but never resolved: the condition cleared (closed_at set,
--    e.g. by the alert-service) but status stayed open/acknowledged, stranding
--    the row in the Open tab forever.
UPDATE alerts
SET status = 'resolved',
    resolved_at = COALESCE(resolved_at, closed_at),
    is_alert_active = false
WHERE closed_at IS NOT NULL
  AND status <> 'resolved';
--> statement-breakpoint

-- B. Human-resolved but machine-open: resolve didn't clear is_alert_active /
--    closed_at, so chart bands grew to `now` forever and the unique active
--    index blocked the next real open for the same (rule, source).
UPDATE alerts
SET is_alert_active = false,
    closed_at = COALESCE(closed_at, resolved_at, now())
WHERE status = 'resolved'
  AND (is_alert_active OR closed_at IS NULL);
--> statement-breakpoint

-- C. Event alerts are points in time, not intervals — new rows are created
--    with closed_at = triggered_at. Stamp legacy rows the same way. (Still-
--    open ones keep their status; the runtime stale-event sweep resolves
--    them after 24h.)
UPDATE alerts
SET closed_at = triggered_at,
    is_alert_active = false
WHERE trigger_type = 'event'
  AND closed_at IS NULL;
--> statement-breakpoint

-- D. Legacy fire-only limit alerts (created before limit alerts were active-
--    tracked): inactive with no close, so no engine would ever touch them.
--    The new recovery path only matches active rows — close these out.
UPDATE alerts
SET status = 'resolved',
    resolved_at = now(),
    closed_at = triggered_at
WHERE trigger_type = 'limit_violation'
  AND is_alert_active = false
  AND closed_at IS NULL
  AND status <> 'resolved';
--> statement-breakpoint

-- E. Uniqueness guard for the new index: if any (org, limit, source) somehow
--    has multiple active rows, keep the newest and close the rest.
UPDATE alerts a
SET is_alert_active = false,
    closed_at = COALESCE(a.closed_at, now())
WHERE a.is_alert_active
  AND a.limit_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM alerts b
    WHERE b.org_id = a.org_id
      AND b.limit_id = a.limit_id
      AND b.source_id = a.source_id
      AND b.is_alert_active
      AND (b.triggered_at > a.triggered_at
           OR (b.triggered_at = a.triggered_at AND b.id > a.id))
  );
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_alerts_one_open_per_limit_source" ON "alerts" USING btree ("org_id","limit_id","source_id") WHERE ((is_alert_active = true) AND (limit_id IS NOT NULL));
