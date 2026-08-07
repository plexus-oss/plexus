-- Reshape the verdict rollup indexes from 00068.
--
-- 00068 keyed rollups per (rule|limit) only and was unordered. We now read verdict
-- history LIVE at panel-open, scoped per (rule|limit, SOURCE) — a fleet rule can be
-- noise on one device and real on another — and windowed by recency (latest-N within
-- a time window). So the index gains `source_id` and ends in `triggered_at DESC` to
-- serve the ordered, source-scoped scan. Partial — only verdicted alerts participate.
--
-- The `alerts.current_verdict` column from 00068 is unchanged.

DROP INDEX IF EXISTS alerts_rule_verdict_idx;
DROP INDEX IF EXISTS alerts_limit_verdict_idx;

CREATE INDEX IF NOT EXISTS alerts_rule_source_verdict_idx
  ON alerts (org_id, rule_id, source_id, triggered_at DESC)
  WHERE current_verdict IS NOT NULL;

CREATE INDEX IF NOT EXISTS alerts_limit_source_verdict_idx
  ON alerts (org_id, limit_id, source_id, triggered_at DESC)
  WHERE current_verdict IS NOT NULL;
