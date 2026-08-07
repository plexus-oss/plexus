-- Add pass/fail criteria and test results to runs
-- Enables structured hardware test validation

ALTER TABLE runs ADD COLUMN pass_criteria JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE runs ADD COLUMN test_result JSONB;

-- Index for filtering runs by pass/fail result
CREATE INDEX idx_runs_test_result ON runs(org_id, (test_result->>'passed'))
  WHERE test_result IS NOT NULL;

COMMENT ON COLUMN runs.pass_criteria IS 'Array of {metric, operator, value, label?} criteria to evaluate on run completion';
COMMENT ON COLUMN runs.test_result IS 'Evaluation result: {passed, evaluated_at, criteria_results[]}';
