-- Drop the legacy satellites table.
-- All satellite data now lives in the `sources` table (device_type = 'satellite').
DROP TABLE IF EXISTS public.satellites;
