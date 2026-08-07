-- Drop feature_flags and org_feature_overrides.
--
-- feature_flags was built but never wired up — no caller outside the db
-- query layer ever read or wrote it, and the min_plan CHECK constraint
-- referenced plan names ('free', 'growth', 'scale') that no longer exist
-- in the application.
--
-- org_feature_overrides was the storage for the lib/features/ registry
-- (per-org pluggable implementations of alerts/notifications/etc).
-- That registry has been removed; resolveFeature was always returning
-- the builtin implementation regardless of org config, so the table's
-- contents had no effect.
--
-- If we ever need real feature flags again, reach for an external service
-- (Vercel flags, GrowthBook, LaunchDarkly) instead of rebuilding this.

DROP TABLE IF EXISTS org_feature_overrides;
DROP TABLE IF EXISTS feature_flags;
