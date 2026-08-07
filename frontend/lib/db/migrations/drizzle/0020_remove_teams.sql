DELETE FROM "dashboard_permissions" WHERE "team_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "source_permissions" WHERE "team_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_permissions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "teams" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "team_members" CASCADE;--> statement-breakpoint
DROP TABLE "team_permissions" CASCADE;--> statement-breakpoint
DROP TABLE "teams" CASCADE;--> statement-breakpoint
ALTER TABLE "dashboard_permissions" DROP CONSTRAINT "dashboard_permissions_grantee_present";--> statement-breakpoint
ALTER TABLE "source_permissions" DROP CONSTRAINT "source_permissions_grantee_present";--> statement-breakpoint
ALTER TABLE "dashboard_permissions" DROP CONSTRAINT IF EXISTS "dashboard_permissions_team_id_fkey";--> statement-breakpoint
ALTER TABLE "source_permissions" DROP CONSTRAINT IF EXISTS "source_permissions_team_id_fkey";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_dashboard_permissions_team_id";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_source_permissions_team";--> statement-breakpoint
DROP INDEX "idx_dashboard_permissions_unique";--> statement-breakpoint
DROP INDEX "idx_source_permissions_unique";--> statement-breakpoint
ALTER TABLE "dashboard_permissions" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "source_permissions" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "org_invites" ADD COLUMN "allowed_source_ids" uuid[];--> statement-breakpoint
ALTER TABLE "org_invites" ADD COLUMN "allowed_satellite_ids" text[];--> statement-breakpoint
CREATE UNIQUE INDEX "idx_dashboard_permissions_unique" ON "dashboard_permissions" USING btree (dashboard_id,COALESCE(user_id, ''::text),COALESCE(email, ''::text),COALESCE(role, ''::text));--> statement-breakpoint
CREATE UNIQUE INDEX "idx_source_permissions_unique" ON "source_permissions" USING btree (COALESCE((source_id)::text, ''::text),COALESCE((source_group_id)::text, ''::text),COALESCE(user_id, ''::text),COALESCE(email, ''::text),COALESCE(role, ''::text));--> statement-breakpoint
ALTER TABLE "dashboard_permissions" ADD CONSTRAINT "dashboard_permissions_grantee_present" CHECK ((user_id IS NOT NULL) OR (email IS NOT NULL) OR (role IS NOT NULL));--> statement-breakpoint
ALTER TABLE "source_permissions" ADD CONSTRAINT "source_permissions_grantee_present" CHECK ((user_id IS NOT NULL) OR (email IS NOT NULL) OR (role IS NOT NULL));
