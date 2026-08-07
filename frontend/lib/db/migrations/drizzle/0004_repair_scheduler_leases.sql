-- Custom SQL migration file, put your code below! --
-- Repair drift: scheduler_leases is in the baseline (0000) but was never created
-- in prod — its legacy migration predated the introspected baseline, and the
-- one-time baseline marked 0000 "applied" without running it. Create it
-- idempotently so this is a no-op on environments that already have the table.
CREATE TABLE IF NOT EXISTS "scheduler_leases" (
	"name" text PRIMARY KEY NOT NULL,
	"holder" text,
	"locked_until" timestamp with time zone DEFAULT to_timestamp((0)::double precision) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
