-- Enable RLS on email_integrations (was missing from original migration)
ALTER TABLE email_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_integrations_org_isolation" ON email_integrations
  FOR ALL USING (org_id = public.get_org_id());

CREATE POLICY "email_integrations_service_role" ON email_integrations
  FOR ALL TO service_role USING (true);

CREATE TRIGGER update_email_integrations_updated_at
  BEFORE UPDATE ON email_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
