-- Remove legacy device token column from sources table.
-- Device tokens (plxd_*) have been replaced by org-level API keys (plx_*).
-- This migration can be applied after the code deployment that stops
-- reading/writing the column.

ALTER TABLE sources DROP COLUMN IF EXISTS token_hash;
DROP INDEX IF EXISTS idx_sources_token_hash;
