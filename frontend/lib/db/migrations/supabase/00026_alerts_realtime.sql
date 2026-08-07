-- Enable Supabase Realtime on the alerts table so browser clients
-- get notified instantly when new alerts are created during ingest.
-- Only INSERTs are broadcast (new alerts); updates/deletes use polling.
ALTER PUBLICATION supabase_realtime ADD TABLE alerts;
