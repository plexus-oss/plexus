ALTER TABLE "event_monitors" ADD COLUMN "last_status" text;--> statement-breakpoint
ALTER TABLE "event_monitors" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "event_monitors" ADD COLUMN "last_evaluated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_limits" ADD COLUMN "last_status" text;--> statement-breakpoint
ALTER TABLE "source_limits" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "source_limits" ADD COLUMN "last_evaluated_at" timestamp with time zone;