-- Fix broken RLS policies that used current_setting('app.org_id', true)
-- which doesn't work in serverless/Supabase environments.
-- Migrate to auth.jwt() ->> 'org_id' which reads the org_id claim
-- directly from the authenticated JWT token.

-- ============================================
-- marker_comments
-- ============================================
DROP POLICY IF EXISTS "marker_comments_org_isolation" ON marker_comments;
CREATE POLICY "marker_comments_org_isolation" ON marker_comments
  FOR ALL USING (org_id = auth.jwt() ->> 'org_id');

-- ============================================
-- test_sessions
-- ============================================
DROP POLICY IF EXISTS "test_sessions_org_isolation" ON test_sessions;
CREATE POLICY "test_sessions_org_isolation" ON test_sessions
  FOR ALL USING (org_id = auth.jwt() ->> 'org_id');

-- ============================================
-- insights
-- ============================================
DROP POLICY IF EXISTS "insights_org_isolation" ON insights;
CREATE POLICY "insights_org_isolation" ON insights
  FOR ALL USING (org_id = auth.jwt() ->> 'org_id');
