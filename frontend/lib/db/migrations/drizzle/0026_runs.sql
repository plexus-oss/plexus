CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"source_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"tags" jsonb,
	"metadata" jsonb,
	"pass_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"test_result" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_valid_status" CHECK (status = ANY (ARRAY['active'::text, 'completed'::text, 'aborted'::text]))
);
--> statement-breakpoint
ALTER TABLE "runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_org_started_idx" ON "runs" USING btree ("org_id","started_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "runs_org_status_idx" ON "runs" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "runs_org_source_idx" ON "runs" USING btree ("org_id","source_id");--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_annotations_run" ON "annotations" USING btree ("org_id","run_id") WHERE (run_id IS NOT NULL);--> statement-breakpoint
CREATE TRIGGER update_runs_updated_at BEFORE UPDATE ON public.runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();--> statement-breakpoint
CREATE TRIGGER notify_runs_change AFTER INSERT OR UPDATE OR DELETE ON public.runs
  FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();