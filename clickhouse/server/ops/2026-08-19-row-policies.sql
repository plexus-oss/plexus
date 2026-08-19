-- ════════════════════════════════════════════════════════════════════════
-- Row-policy backstop — DB-enforced tenant isolation (Option B)
-- Operator-run migration. NOT auto-applied (schema.sql keeps these commented).
-- ════════════════════════════════════════════════════════════════════════
--
-- ⚠️  APPLYING THIS BEGINS ENFORCEMENT for `nextjs_reader`: once ANY policy
--     exists on a table, that user sees ZERO rows unless a policy matches. Only
--     run this AFTER the shadow pass is clean (see the README next to this file):
--       PLEXUS_CH_ROW_POLICY_SHADOW=1 for ≥48h, grep Fly logs for
--       `[ch-shadow]` `"risk":true` → must be EMPTY.
--
-- Rollout order (matches schema.sql header):
--   1. Server config <custom_settings_prefixes>plexus_</> — already deployed.
--   2. Run the nextjs_global section below; set PLEXUS_CLICKHOUSE_GLOBAL_USER /
--      _GLOBAL_PASSWORD on the frontend (fly secrets).
--   3. Deploy frontend with wiring merged (no-op while both flags off).
--   4. Shadow clean → run the POLICY section below → flip PLEXUS_CH_ROW_POLICY=1.
--   Rollback: unset PLEXUS_CH_ROW_POLICY (policies can stay; the app simply
--   stops stamping the setting, and nextjs_reader would then blank — so to fully
--   roll back, also DROP the policies with the block at the very bottom).

-- ── nextjs_global: cross-org reads that must BYPASS the per-org filter ──────
-- (rollup reconciliation, ops aggregations). NOT targeted by any policy below.
CREATE USER IF NOT EXISTS nextjs_global
    IDENTIFIED WITH sha256_password BY '${CH_GLOBAL_PASSWORD}'
    SETTINGS readonly = 1;
GRANT SELECT ON plexus.* TO nextjs_global;

-- ── One PERMISSIVE policy per tenant table, TARGETING nextjs_reader ─────────
-- A row is visible iff its org_id equals the per-query `plexus_org_id` setting
-- the frontend stamps (lib/db/clickhouse.ts getClient(orgId)). A read that never
-- sets it sees nothing → fail-closed. Apply to BOTH local and _dist variants.

CREATE ROW POLICY IF NOT EXISTS org_isolation ON plexus.telemetry
    ON CLUSTER observability_cluster
    AS PERMISSIVE USING org_id = getSetting('plexus_org_id') TO nextjs_reader;
CREATE ROW POLICY IF NOT EXISTS org_isolation ON plexus.telemetry_dist
    ON CLUSTER observability_cluster
    AS PERMISSIVE USING org_id = getSetting('plexus_org_id') TO nextjs_reader;

CREATE ROW POLICY IF NOT EXISTS org_isolation ON plexus.telemetry_1min
    ON CLUSTER observability_cluster
    AS PERMISSIVE USING org_id = getSetting('plexus_org_id') TO nextjs_reader;
CREATE ROW POLICY IF NOT EXISTS org_isolation ON plexus.telemetry_1min_dist
    ON CLUSTER observability_cluster
    AS PERMISSIVE USING org_id = getSetting('plexus_org_id') TO nextjs_reader;

CREATE ROW POLICY IF NOT EXISTS org_isolation ON plexus.telemetry_1hr
    ON CLUSTER observability_cluster
    AS PERMISSIVE USING org_id = getSetting('plexus_org_id') TO nextjs_reader;
CREATE ROW POLICY IF NOT EXISTS org_isolation ON plexus.telemetry_1hr_dist
    ON CLUSTER observability_cluster
    AS PERMISSIVE USING org_id = getSetting('plexus_org_id') TO nextjs_reader;

CREATE ROW POLICY IF NOT EXISTS org_isolation ON plexus.events
    ON CLUSTER observability_cluster
    AS PERMISSIVE USING org_id = getSetting('plexus_org_id') TO nextjs_reader;
CREATE ROW POLICY IF NOT EXISTS org_isolation ON plexus.events_dist
    ON CLUSTER observability_cluster
    AS PERMISSIVE USING org_id = getSetting('plexus_org_id') TO nextjs_reader;

CREATE ROW POLICY IF NOT EXISTS org_isolation ON plexus.video_sessions
    ON CLUSTER observability_cluster
    AS PERMISSIVE USING org_id = getSetting('plexus_org_id') TO nextjs_reader;
CREATE ROW POLICY IF NOT EXISTS org_isolation ON plexus.video_sessions_dist
    ON CLUSTER observability_cluster
    AS PERMISSIVE USING org_id = getSetting('plexus_org_id') TO nextjs_reader;

-- ── ROLLBACK (run to fully undo enforcement) ───────────────────────────────
-- Unset PLEXUS_CH_ROW_POLICY on the frontend FIRST, then:
--   DROP ROW POLICY IF EXISTS org_isolation ON plexus.telemetry           ON CLUSTER observability_cluster;
--   DROP ROW POLICY IF EXISTS org_isolation ON plexus.telemetry_dist      ON CLUSTER observability_cluster;
--   DROP ROW POLICY IF EXISTS org_isolation ON plexus.telemetry_1min      ON CLUSTER observability_cluster;
--   DROP ROW POLICY IF EXISTS org_isolation ON plexus.telemetry_1min_dist ON CLUSTER observability_cluster;
--   DROP ROW POLICY IF EXISTS org_isolation ON plexus.telemetry_1hr       ON CLUSTER observability_cluster;
--   DROP ROW POLICY IF EXISTS org_isolation ON plexus.telemetry_1hr_dist  ON CLUSTER observability_cluster;
--   DROP ROW POLICY IF EXISTS org_isolation ON plexus.events              ON CLUSTER observability_cluster;
--   DROP ROW POLICY IF EXISTS org_isolation ON plexus.events_dist         ON CLUSTER observability_cluster;
--   DROP ROW POLICY IF EXISTS org_isolation ON plexus.video_sessions      ON CLUSTER observability_cluster;
--   DROP ROW POLICY IF EXISTS org_isolation ON plexus.video_sessions_dist ON CLUSTER observability_cluster;
