-- Add icon_url to dashboards for uploaded custom logos/images.
-- Orthogonal to the existing `icon` column (Lucide name or emoji):
-- when both are set, the UI renders icon_url and keeps `icon` as fallback.
-- Storage: public Supabase bucket `dashboard-icons`, path {org_id}/{dashboard_id}/{uuid}.{ext}.

ALTER TABLE dashboards
  ADD COLUMN icon_url TEXT;

-- Public bucket so anonymous shared-dashboard viewers can load the logo.
-- Writes always go through the service-role client in the upload route,
-- so we don't need INSERT/UPDATE/DELETE policies for end users.
INSERT INTO storage.buckets (id, name, public)
VALUES ('dashboard-icons', 'dashboard-icons', true)
ON CONFLICT (id) DO NOTHING;
