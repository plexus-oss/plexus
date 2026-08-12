ALTER TABLE "alert_rules" ADD COLUMN "silenced_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_monitors" ADD COLUMN "silenced_until" timestamp with time zone;