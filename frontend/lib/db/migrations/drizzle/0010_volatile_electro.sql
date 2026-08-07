ALTER TABLE "source_limits" ADD COLUMN "table_name" text;--> statement-breakpoint
ALTER TABLE "source_limits" ADD COLUMN "time_column" text;--> statement-breakpoint
ALTER TABLE "source_limits" ADD COLUMN "poll_watermark" text;--> statement-breakpoint
ALTER TABLE "source_limits" ADD COLUMN "last_polled_at" timestamp with time zone;