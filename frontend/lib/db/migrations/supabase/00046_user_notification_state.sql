-- Per-user notification "last seen" state, scoped to an org.
--
-- Replaces the localStorage-only tracking that powered the bell badge.
-- A single timestamp per (user, org): the last time the user opened the
-- alerts dropdown. The badge pulses when any open alert has triggered_at
-- after this timestamp.

CREATE TABLE IF NOT EXISTS user_notification_state (
  user_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  alerts_last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS user_notification_state_org_id_idx
  ON user_notification_state (org_id);

ALTER TABLE user_notification_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_notification_state_org_isolation"
  ON user_notification_state
  FOR ALL USING (org_id = public.get_org_id());

CREATE POLICY "user_notification_state_service_role"
  ON user_notification_state FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_user_notification_state_updated_at
  BEFORE UPDATE ON user_notification_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
