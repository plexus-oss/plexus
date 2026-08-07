DROP POLICY IF EXISTS "insights_org_isolation" ON insights;
DROP POLICY IF EXISTS "insights_service_role" ON insights;
DROP INDEX IF EXISTS idx_insights_active;
DROP INDEX IF EXISTS idx_insights_source;
DROP INDEX IF EXISTS idx_insights_org;
DROP TABLE IF EXISTS insights;
