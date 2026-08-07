-- Source associations: link a connection table to a device or satellite
CREATE TABLE source_associations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('device', 'satellite')),
  entity_id UUID NOT NULL,
  connection_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  table_schema TEXT,
  filter_column TEXT,
  filter_value TEXT,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_source_assoc_entity ON source_associations(org_id, entity_type, entity_id);
CREATE INDEX idx_source_assoc_connection ON source_associations(org_id, connection_id);
CREATE UNIQUE INDEX idx_source_assoc_unique
  ON source_associations(org_id, entity_id, connection_id, table_name);

ALTER TABLE source_associations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "source_associations_org_isolation" ON source_associations
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "source_associations_service_role" ON source_associations
  FOR ALL TO service_role USING (true);
CREATE TRIGGER update_source_associations_updated_at
  BEFORE UPDATE ON source_associations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
