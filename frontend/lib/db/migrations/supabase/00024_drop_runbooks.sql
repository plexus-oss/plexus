-- Drop runbooks feature entirely
-- Tables: runbooks, runbook_runs
-- Also drop runbook FK columns from commands table

-- Drop runbook columns from commands first (FK dependency)
ALTER TABLE commands DROP COLUMN IF EXISTS runbook_id;
ALTER TABLE commands DROP COLUMN IF EXISTS runbook_step_index;

-- Drop runbook_runs (depends on runbooks)
DROP TABLE IF EXISTS runbook_runs;

-- Drop runbooks
DROP TABLE IF EXISTS runbooks;

-- Drop enum
DROP TYPE IF EXISTS runbook_status;
