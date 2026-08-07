-- Change sources.config default to {"recording": false}.
-- Recording is opt-in: sources only persist telemetry to ClickHouse when
-- config.recording is explicitly set to true. New sources created without
-- an explicit config will default to not recording.
--
-- Note: migration 00031 already backfilled config.recording from storage_mode
-- for all existing sources, so no backfill is needed here.

ALTER TABLE sources
  ALTER COLUMN config SET DEFAULT '{"recording": false}'::jsonb;
