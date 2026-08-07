-- Leader-election leases for in-process singleton loops.
--
-- The notification drain loop assumes a single always-on Fly machine. The
-- offline ("stream stopped") detector runs the same way, but to stay correct if
-- the frontend ever scales past one machine, each tick must claim a short lease
-- here first — only the lease holder scans, so no double-firing of alerts.
--
-- A claim is a single atomic UPDATE: WHERE locked_until < now() OR holder = me
-- (see lib/scheduler/leader-lease.ts). One row per named job.

CREATE TABLE IF NOT EXISTS scheduler_leases (
    name         TEXT PRIMARY KEY,
    holder       TEXT,
    locked_until TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the offline detector's lease in the past so the first tick can claim it.
INSERT INTO scheduler_leases (name, locked_until)
VALUES ('detect-offline', to_timestamp(0))
ON CONFLICT (name) DO NOTHING;

-- This is a global (not org-scoped) table touched only by service-role
-- in-process loops, so there is no org_id to isolate on. Enable RLS with a
-- service-role-only policy: the loops bypass it, and every anon/authenticated
-- client is denied (no permissive policy applies to them). Mirrors the
-- service_role policy on notification_deliveries (migration 00058).
ALTER TABLE scheduler_leases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scheduler_leases_service_role" ON scheduler_leases;
CREATE POLICY "scheduler_leases_service_role" ON scheduler_leases
  FOR ALL TO service_role USING (true);
