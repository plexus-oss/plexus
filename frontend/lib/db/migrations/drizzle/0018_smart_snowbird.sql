ALTER TABLE "alert_rules" ADD COLUMN "notification_target_ids" uuid[];--> statement-breakpoint
ALTER TABLE "event_monitors" ADD COLUMN "notification_target_ids" uuid[];