-- Runbook Runs - tracks execution history of runbooks
CREATE TABLE IF NOT EXISTS runbook_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  runbook_id UUID NOT NULL REFERENCES runbooks(id) ON DELETE CASCADE,
  source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  started_by TEXT,
  step_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE runbook_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "runbook_runs_org_isolation" ON runbook_runs
  USING (org_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'));

-- Indexes
CREATE INDEX idx_runbook_runs_org ON runbook_runs(org_id);
CREATE INDEX idx_runbook_runs_runbook ON runbook_runs(runbook_id);
CREATE INDEX idx_runbook_runs_started ON runbook_runs(started_at DESC);
