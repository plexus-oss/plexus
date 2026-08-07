-- Hosted prospect demos. One row per long-running prospect demo running
-- on the multiplexer (demo/_lib/runner.py). Not org-scoped — these are
-- Plexus-internal resources managed from /internal/demos by staff.
--
-- The multiplexer polls this table (via an internal API-key endpoint) to
-- know which prospect scenarios to spawn/stop worker threads for.
CREATE TABLE hosted_demos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_slug TEXT NOT NULL UNIQUE,
  scenario TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'stopping', 'error')),
  status_detail TEXT,
  dashboard_id UUID,
  share_token TEXT,
  created_by_user_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_hosted_demos_status ON hosted_demos(status);

-- No org_id column → no RLS policy. Access is gated entirely by the
-- withPlexusStaff wrapper on /api/internal/demos/* and by service_role
-- for the runner polling endpoint.
ALTER TABLE hosted_demos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hosted_demos_service_role" ON hosted_demos
  FOR ALL TO service_role USING (true);

CREATE TRIGGER update_hosted_demos_updated_at
  BEFORE UPDATE ON hosted_demos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
