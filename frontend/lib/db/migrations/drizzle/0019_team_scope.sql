ALTER TABLE "org_invites" ALTER COLUMN "role" SET DEFAULT 'org:viewer';--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "allowed_source_ids" uuid[];--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "allowed_satellite_ids" text[];--> statement-breakpoint
UPDATE "org_members" SET "role" = 'org:viewer' WHERE "role" = 'org:member';--> statement-breakpoint
UPDATE "org_invites" SET "role" = 'org:viewer' WHERE "role" = 'org:member' AND "accepted_at" IS NULL;--> statement-breakpoint
UPDATE "org_members" SET "allowed_source_ids" = NULL, "allowed_satellite_ids" = NULL WHERE "role" = 'org:admin' AND ("allowed_source_ids" IS NOT NULL OR "allowed_satellite_ids" IS NOT NULL);
