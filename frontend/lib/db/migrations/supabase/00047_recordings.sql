-- Video recording sessions.
--
-- gateway_api_key is a raw API key scoped to this org, created at recording
-- start and deleted when the recording ends. It is intentionally excluded from
-- the user-facing RLS policy so it never reaches the browser.

CREATE TABLE IF NOT EXISTS recordings (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             TEXT        NOT NULL,
  camera_id          TEXT        NOT NULL,
  gateway_api_key    TEXT        NOT NULL,
  gateway_api_key_id UUID,
  status             TEXT        NOT NULL DEFAULT 'requested',
  expires_at         TIMESTAMPTZ NOT NULL,
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ,
  playback_url       TEXT,
  error_message      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX recordings_org_status_idx ON recordings (org_id, status);
CREATE INDEX recordings_expires_idx    ON recordings (expires_at) WHERE status IN ('requested', 'recording');

ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;

-- Users can read their own org's recordings but never see the raw API key.
CREATE POLICY "recordings_org_read"
  ON recordings FOR SELECT
  USING (org_id = public.get_org_id());

-- Inserts and updates go through service_role only (API routes use admin client).
CREATE POLICY "recordings_service_role"
  ON recordings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_recordings_updated_at
  BEFORE UPDATE ON recordings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
