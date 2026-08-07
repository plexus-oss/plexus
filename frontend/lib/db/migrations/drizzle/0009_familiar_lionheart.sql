ALTER TABLE "event_monitors" ADD COLUMN "table_name" text;--> statement-breakpoint
ALTER TABLE "event_monitors" ADD COLUMN "time_column" text;--> statement-breakpoint
ALTER TABLE "event_monitors" ADD COLUMN "poll_watermark" text;--> statement-breakpoint
ALTER TABLE "event_monitors" ADD COLUMN "last_polled_at" timestamp with time zone;