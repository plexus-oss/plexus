-- User-authored column annotations for better AI/ML inference.
--
-- Works for BOTH device sources (column_key = metric name) and connection
-- sources (column_key = "table.column", whose schema is otherwise never
-- persisted). source_id is the source SLUG, matching device_schemas.
--
-- Unlike device_schemas (service-role write only, populated by ingest), this
-- table is org-writable: users author it interactively from the Data tab.
CREATE TABLE column_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  source_id TEXT NOT NULL,          -- source slug
  column_key TEXT NOT NULL,         -- metric name | "table.column"

  -- Promoted, queryable annotation fields
  label TEXT,
  description TEXT,
  unit TEXT,
  semantic_type TEXT CHECK (semantic_type IN
    ('identifier','category','measurement','status','location','timestamp','text','boolean')),
  ml_role TEXT CHECK (ml_role IN ('feature','target','identifier','ignore')),
  aggregation TEXT CHECK (aggregation IN ('avg','sum','min','max','last','none')),
  sensitivity TEXT NOT NULL DEFAULT 'none'
    CHECK (sensitivity IN ('none','pii','sensitive')),
  expected_min DOUBLE PRECISION,
  expected_max DOUBLE PRECISION,

  -- List fields + forward-compat overflow
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,   -- string[]
  tags       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- string[]
  extra      JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- AI provenance
  ai_suggested JSONB,               -- last suggestion payload, or null
  source_origin TEXT NOT NULL DEFAULT 'user'
    CHECK (source_origin IN ('user','ai','ai_accepted')),

  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_column_metadata_unique
  ON column_metadata(org_id, source_id, column_key);
CREATE INDEX idx_column_metadata_source
  ON column_metadata(org_id, source_id);

ALTER TABLE column_metadata ENABLE ROW LEVEL SECURITY;

-- Users author this interactively, so the org can read AND write.
CREATE POLICY "column_metadata_org_isolation" ON column_metadata
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "column_metadata_service_role" ON column_metadata
  FOR ALL TO service_role USING (true);

CREATE TRIGGER update_column_metadata_updated_at
  BEFORE UPDATE ON column_metadata
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
