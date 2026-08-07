-- Feature Flags & Feature Overrides Migration
--
-- Adds two tables:
-- 1. feature_flags: Per-org feature flag definitions with global defaults
-- 2. org_feature_overrides: Per-org implementation overrides for feature domains

-- ============================================
-- 1. FEATURE FLAGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT, -- NULL = global default
  key TEXT NOT NULL,
  flag_type TEXT NOT NULL DEFAULT 'boolean' CHECK (flag_type IN ('boolean', 'percentage', 'plan_gated')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  percentage INTEGER CHECK (percentage >= 0 AND percentage <= 100),
  min_plan TEXT CHECK (min_plan IN ('free', 'pro', 'enterprise')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);

-- Partial unique index for global defaults (org_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_global_key_unique
  ON feature_flags (key) WHERE org_id IS NULL;

-- Index for org lookups
CREATE INDEX IF NOT EXISTS feature_flags_org_id_idx ON feature_flags (org_id) WHERE org_id IS NOT NULL;

-- RLS
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

-- Orgs can read their own flags + global defaults
CREATE POLICY "feature_flags_org_read" ON feature_flags
  FOR SELECT USING (org_id IS NULL OR org_id = public.get_org_id());

-- Orgs can manage their own flags (not global defaults)
CREATE POLICY "feature_flags_org_write" ON feature_flags
  FOR ALL USING (org_id = public.get_org_id());

-- Service role bypass
CREATE POLICY "feature_flags_service_role" ON feature_flags
  FOR ALL TO service_role USING (true);

-- Updated at trigger
CREATE TRIGGER update_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 2. ORG FEATURE OVERRIDES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS org_feature_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  feature_domain TEXT NOT NULL CHECK (feature_domain IN ('alerts', 'notifications', 'rca', 'data_sources')),
  implementation_key TEXT NOT NULL DEFAULT 'builtin',
  config JSONB DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, feature_domain)
);

-- RLS
ALTER TABLE org_feature_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_feature_overrides_org_isolation" ON org_feature_overrides
  FOR ALL USING (org_id = public.get_org_id());

CREATE POLICY "org_feature_overrides_service_role" ON org_feature_overrides
  FOR ALL TO service_role USING (true);

-- Updated at trigger
CREATE TRIGGER update_org_feature_overrides_updated_at
  BEFORE UPDATE ON org_feature_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
