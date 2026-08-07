-- Custom SQL migration file, put your code below! --
-- Seed the leader-election lease row for the offline loop. tryAcquireLease is an
-- UPDATE (it claims an EXISTING row), so without this seed the loop never becomes
-- leader and reconcile-last-seen / detect-offline never run — which leaves every
-- source stuck at status=pending / last_seen_at=NULL. Idempotent.
INSERT INTO scheduler_leases (name, locked_until)
VALUES ('detect-offline', to_timestamp(0))
ON CONFLICT (name) DO NOTHING;
