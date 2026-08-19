CREATE TABLE "embed_publishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"dashboard_id" text NOT NULL,
	"panel_id" text NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"time_range" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "embed_publishes_token_key" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "embed_publishes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "idx_embed_publishes_panel" ON "embed_publishes" USING btree ("org_id","dashboard_id","panel_id");