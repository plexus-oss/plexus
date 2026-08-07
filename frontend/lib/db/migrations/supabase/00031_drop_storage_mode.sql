-- Drop sources.storage_mode
--
-- The column is redundant with config.recording. This migration:
--   1. Backfills config.recording from storage_mode so no setting is lost.
--   2. Normalizes any legacy device_type='placeholder' rows to NULL
--      (placeholder was removed as a concept).
--   3. Drops the storage_mode column (removes the CHECK constraint too).

-- 1. Backfill: config.recording = (storage_mode = 'persistent')
--    Preserves existing config, only sets/overwrites the `recording` key.
UPDATE sources
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{recording}',
  to_jsonb(storage_mode = 'persistent'),
  true
)
WHERE source_type = 'device';

-- 2. Drop the "placeholder" device_type — no longer a real concept.
UPDATE sources
SET device_type = NULL
WHERE device_type = 'placeholder';

-- 3. Drop the column (CHECK constraint drops automatically).
ALTER TABLE sources DROP COLUMN IF EXISTS storage_mode;
