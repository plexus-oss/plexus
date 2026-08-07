ALTER TABLE "recordings" ADD COLUMN "source_id" text;--> statement-breakpoint
CREATE INDEX "recordings_org_source_idx" ON "recordings" USING btree ("org_id","source_id");