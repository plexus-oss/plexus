-- Phase 3.5: mirror member avatars so the activity feed can resolve actor
-- profiles from the DB instead of Clerk. Also carries the user_id index
-- for deployments that applied 00051 before it included one.

ALTER TABLE org_members
  ADD COLUMN IF NOT EXISTS image_url TEXT;

CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON org_members (user_id);
