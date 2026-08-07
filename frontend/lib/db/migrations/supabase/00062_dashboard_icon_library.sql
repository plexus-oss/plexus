-- Org-wide dashboard icon library. Uploaded icon images are saved as reusable
-- org assets (stored at {orgId}/library/{uuid} in the dashboard-icons bucket)
-- instead of one-off per-dashboard files, so they can be re-selected from the
-- icon picker's Upload tab. Storage objects are only deleted via the explicit
-- library-asset DELETE, never when a dashboard swaps or clears its icon.

CREATE TABLE IF NOT EXISTS dashboard_icon_assets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       TEXT NOT NULL,
  url          TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_name    TEXT,
  content_type TEXT,
  size_bytes   INTEGER,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_icon_assets_org
  ON dashboard_icon_assets (org_id, created_at DESC);

ALTER TABLE dashboard_icon_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dashboard_icon_assets_org_isolation" ON dashboard_icon_assets
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "dashboard_icon_assets_service_role" ON dashboard_icon_assets
  FOR ALL TO service_role USING (true) WITH CHECK (true);
