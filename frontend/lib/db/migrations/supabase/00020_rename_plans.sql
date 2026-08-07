-- Rename plans: free/pro/team/enterprise/custom → free/growth/scale
--
-- Updates the feature_flags min_plan CHECK constraint and migrates
-- existing rows to the new plan names.

-- Migrate existing rows first
UPDATE feature_flags SET min_plan = 'growth' WHERE min_plan IN ('pro', 'team');
UPDATE feature_flags SET min_plan = 'scale' WHERE min_plan IN ('enterprise', 'custom');

-- Replace CHECK constraint
ALTER TABLE feature_flags
  DROP CONSTRAINT IF EXISTS feature_flags_min_plan_check;

ALTER TABLE feature_flags
  ADD CONSTRAINT feature_flags_min_plan_check
  CHECK (min_plan IN ('free', 'growth', 'scale'));
