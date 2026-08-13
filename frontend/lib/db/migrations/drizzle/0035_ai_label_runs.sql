CREATE TABLE "ai_label_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"provider" text,
	"model" text,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"metrics" jsonb,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"context_items" jsonb,
	"observations" jsonb
);
--> statement-breakpoint
CREATE INDEX "ai_label_runs_org_created_idx" ON "ai_label_runs" USING btree ("org_id","created_at" DESC NULLS FIRST);