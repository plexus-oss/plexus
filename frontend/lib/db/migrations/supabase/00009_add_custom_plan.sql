-- Add 'custom' to the min_plan CHECK constraint on feature_flags
--
-- The original inline CHECK only allowed free/pro/enterprise.
-- Custom-plan orgs need to be representable in feature gating.

ALTER TABLE feature_flags
  DROP CONSTRAINT IF EXISTS feature_flags_min_plan_check;

ALTER TABLE feature_flags
  ADD CONSTRAINT feature_flags_min_plan_check
  CHECK (min_plan IN ('free', 'pro', 'enterprise', 'custom'));
