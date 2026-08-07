CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "lab_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"corpus_id" uuid NOT NULL,
	"corpus_source_id" uuid,
	"kind" text NOT NULL,
	"ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(1024),
	"embedded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_chunks_hash_uni" UNIQUE("corpus_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "lab_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"corpus_id" uuid NOT NULL,
	"title" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lab_corpora" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"embedding_model" text DEFAULT 'voyage-3.5-lite' NOT NULL,
	"embedding_dim" integer DEFAULT 1024 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_built_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_corpora_org_name_uni" UNIQUE("org_id","name"),
	CONSTRAINT "lab_corpora_status_chk" CHECK (status = ANY (ARRAY['draft'::text, 'building'::text, 'ready'::text, 'error'::text]))
);
--> statement-breakpoint
CREATE TABLE "lab_corpus_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"corpus_id" uuid NOT NULL,
	"source_id" uuid,
	"kind" text NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"watermark" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_corpus_sources_uni" UNIQUE NULLS NOT DISTINCT("corpus_id","kind","source_id"),
	CONSTRAINT "lab_corpus_sources_kind_chk" CHECK (kind = ANY (ARRAY['telemetry_digest'::text, 'alert_history'::text, 'schema_card'::text, 'source_context'::text, 'external_factor'::text, 'document'::text]))
);
--> statement-breakpoint
CREATE TABLE "lab_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"corpus_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"corpus_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"mode" text DEFAULT 'full' NOT NULL,
	"stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_runs_status_chk" CHECK (status = ANY (ARRAY['queued'::text, 'running'::text, 'complete'::text, 'error'::text])),
	CONSTRAINT "lab_runs_mode_chk" CHECK (mode = ANY (ARRAY['full'::text, 'incremental'::text]))
);
--> statement-breakpoint
ALTER TABLE "lab_chunks" ADD CONSTRAINT "lab_chunks_corpus_fkey" FOREIGN KEY ("corpus_id") REFERENCES "public"."lab_corpora"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_chunks" ADD CONSTRAINT "lab_chunks_corpus_source_fkey" FOREIGN KEY ("corpus_source_id") REFERENCES "public"."lab_corpus_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_conversations" ADD CONSTRAINT "lab_conversations_corpus_fkey" FOREIGN KEY ("corpus_id") REFERENCES "public"."lab_corpora"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_corpus_sources" ADD CONSTRAINT "lab_corpus_sources_corpus_fkey" FOREIGN KEY ("corpus_id") REFERENCES "public"."lab_corpora"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_corpus_sources" ADD CONSTRAINT "lab_corpus_sources_source_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_documents" ADD CONSTRAINT "lab_documents_corpus_fkey" FOREIGN KEY ("corpus_id") REFERENCES "public"."lab_corpora"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_runs" ADD CONSTRAINT "lab_runs_corpus_fkey" FOREIGN KEY ("corpus_id") REFERENCES "public"."lab_corpora"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_chunks_org_corpus_idx" ON "lab_chunks" USING btree ("org_id","corpus_id");--> statement-breakpoint
CREATE INDEX "lab_chunks_corpus_kind_idx" ON "lab_chunks" USING btree ("corpus_id","kind");--> statement-breakpoint
CREATE INDEX "lab_conversations_org_user_idx" ON "lab_conversations" USING btree ("org_id","user_id","updated_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "lab_corpora_org_idx" ON "lab_corpora" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "lab_corpus_sources_corpus_idx" ON "lab_corpus_sources" USING btree ("corpus_id");--> statement-breakpoint
CREATE INDEX "lab_documents_org_corpus_idx" ON "lab_documents" USING btree ("org_id","corpus_id");--> statement-breakpoint
CREATE INDEX "lab_runs_org_corpus_created_idx" ON "lab_runs" USING btree ("org_id","corpus_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "lab_runs_queued_idx" ON "lab_runs" USING btree ("created_at") WHERE status = 'queued';--> statement-breakpoint
CREATE INDEX "lab_chunks_embedding_hnsw_idx" ON "lab_chunks" USING hnsw ("embedding" vector_cosine_ops);