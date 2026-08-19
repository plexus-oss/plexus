CREATE TABLE "embed_origins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"origin" text NOT NULL,
	"domain" text NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embed_origins_org_origin_key" UNIQUE("org_id","origin")
);
--> statement-breakpoint
ALTER TABLE "embed_origins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "idx_embed_origins_org" ON "embed_origins" USING btree ("org_id");