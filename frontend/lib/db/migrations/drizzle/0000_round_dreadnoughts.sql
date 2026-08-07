CREATE TYPE "public"."alert_rule_operator" AS ENUM('and', 'or');--> statement-breakpoint
CREATE TYPE "public"."alert_rule_type" AS ENUM('threshold', 'outlier', 'compound', 'offline');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('critical', 'warning', 'info');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."alert_trigger_type" AS ENUM('limit_violation', 'event', 'alert_rule');--> statement-breakpoint
CREATE TYPE "public"."feedback_type" AS ENUM('bug', 'feature', 'general');--> statement-breakpoint
CREATE TYPE "public"."share_link_access" AS ENUM('view', 'edit');--> statement-breakpoint
CREATE TYPE "public"."share_link_status" AS ENUM('active', 'expired', 'revoked');--> statement-breakpoint
CREATE TABLE "access_overrides" (
	"org_id" text NOT NULL,
	"action_id" text NOT NULL,
	"required_role" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_overrides_pkey" PRIMARY KEY("org_id","action_id"),
	CONSTRAINT "access_overrides_role_chk" CHECK ((required_role IS NULL) OR (required_role = ANY (ARRAY['org:viewer'::text, 'org:editor'::text, 'org:admin'::text])))
);
--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"alert_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_id" text,
	"message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source_id" text NOT NULL,
	"type" "alert_rule_type" NOT NULL,
	"metric" text,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"operator" "alert_rule_operator",
	"sub_rules" jsonb,
	"hysteresis_seconds" integer,
	"cooldown_seconds" integer,
	"severity" text DEFAULT 'warning' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_rules_cooldown_seconds_check" CHECK (cooldown_seconds >= 0),
	CONSTRAINT "alert_rules_hysteresis_seconds_check" CHECK (hysteresis_seconds >= 0),
	CONSTRAINT "alert_rules_type_shape" CHECK (((type = 'compound'::alert_rule_type) AND (metric IS NULL) AND (operator IS NOT NULL) AND (sub_rules IS NOT NULL)) OR ((type = ANY (ARRAY['threshold'::alert_rule_type, 'outlier'::alert_rule_type])) AND (metric IS NOT NULL) AND (operator IS NULL) AND (sub_rules IS NULL)) OR ((metric IS NULL) AND (operator IS NULL) AND (sub_rules IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source_id" uuid,
	"trigger_type" "alert_trigger_type" NOT NULL,
	"metric" text NOT NULL,
	"value" numeric NOT NULL,
	"threshold" numeric,
	"bound" text,
	"severity" "alert_severity" DEFAULT 'warning' NOT NULL,
	"status" "alert_status" DEFAULT 'open' NOT NULL,
	"recommended_actions" jsonb DEFAULT '[]'::jsonb,
	"alert_stats" jsonb DEFAULT '[]'::jsonb,
	"context_snapshot" jsonb DEFAULT '{}'::jsonb,
	"limit_id" uuid,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"rule_id" uuid,
	"is_alert_active" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source_type" text DEFAULT 'device' NOT NULL,
	"source_id" text,
	"telemetry_id" text,
	"timestamp_start" timestamp with time zone NOT NULL,
	"timestamp_end" timestamp with time zone,
	"metric_name" text,
	"value_snapshot" jsonb,
	"label" text NOT NULL,
	"notes" text,
	"color" text DEFAULT 'amber',
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"scopes" text[],
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"access_enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"expires_at" bigint,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "auth_accounts_pkey" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_verification_tokens_pkey" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "column_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source_id" text NOT NULL,
	"column_key" text NOT NULL,
	"label" text,
	"description" text,
	"unit" text,
	"semantic_type" text,
	"ml_role" text,
	"aggregation" text,
	"sensitivity" text DEFAULT 'none' NOT NULL,
	"expected_min" double precision,
	"expected_max" double precision,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_suggested" jsonb,
	"source_origin" text DEFAULT 'user' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "column_metadata_aggregation_check" CHECK (aggregation = ANY (ARRAY['avg'::text, 'sum'::text, 'min'::text, 'max'::text, 'last'::text, 'none'::text])),
	CONSTRAINT "column_metadata_ml_role_check" CHECK (ml_role = ANY (ARRAY['feature'::text, 'target'::text, 'identifier'::text, 'ignore'::text])),
	CONSTRAINT "column_metadata_semantic_type_check" CHECK (semantic_type = ANY (ARRAY['identifier'::text, 'category'::text, 'measurement'::text, 'status'::text, 'location'::text, 'timestamp'::text, 'text'::text, 'boolean'::text])),
	CONSTRAINT "column_metadata_sensitivity_check" CHECK (sensitivity = ANY (ARRAY['none'::text, 'pii'::text, 'sensitive'::text])),
	CONSTRAINT "column_metadata_source_origin_check" CHECK (source_origin = ANY (ARRAY['user'::text, 'ai'::text, 'ai_accepted'::text]))
);
--> statement-breakpoint
CREATE TABLE "command_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"device_type" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"created_by" text,
	CONSTRAINT "command_definitions_org_id_name_key" UNIQUE("org_id","name")
);
--> statement-breakpoint
CREATE TABLE "dashboard_icon_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"url" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text,
	"content_type" text,
	"size_bytes" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"user_id" text,
	"email" text,
	"access_level" "share_link_access" DEFAULT 'view' NOT NULL,
	"invited_by" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"team_id" uuid,
	"role" text,
	CONSTRAINT "dashboard_permissions_grantee_present" CHECK ((user_id IS NOT NULL) OR (email IS NOT NULL) OR (team_id IS NOT NULL) OR (role IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "dashboard_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"token" text NOT NULL,
	"name" text,
	"access_level" "share_link_access" DEFAULT 'view' NOT NULL,
	"status" "share_link_status" DEFAULT 'active' NOT NULL,
	"password_hash" text,
	"expires_at" timestamp with time zone,
	"max_views" integer,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "dashboard_share_links_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "dashboard_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"share_link_id" uuid,
	"viewer_id" text,
	"session_id" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"referrer" text,
	"country" text,
	"city" text,
	"duration_seconds" integer,
	"panels_viewed" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"parent_id" uuid,
	"icon" text,
	"icon_url" text,
	"visibility" text DEFAULT 'org' NOT NULL,
	"created_by" text,
	CONSTRAINT "dashboards_visibility_chk" CHECK (visibility = ANY (ARRAY['org'::text, 'restricted'::text]))
);
--> statement-breakpoint
CREATE TABLE "device_auth_requests" (
	"device_code" text PRIMARY KEY NOT NULL,
	"user_code" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"org_id" text,
	"api_key_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "device_auth_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text, 'expired'::text]))
);
--> statement-breakpoint
CREATE TABLE "device_schemas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source_id" text NOT NULL,
	"metric" text NOT NULL,
	"value_type" text NOT NULL,
	"sample_count" bigint DEFAULT 1 NOT NULL,
	"min_value" double precision,
	"max_value" double precision,
	"last_value_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "device_schemas_value_type_check" CHECK (value_type = ANY (ARRAY['number'::text, 'string'::text, 'boolean'::text, 'object'::text, 'array'::text]))
);
--> statement-breakpoint
CREATE TABLE "email_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"email_address" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"events" text[] DEFAULT '{"alert.triggered","alert.resolved"}' NOT NULL,
	"total_events" integer DEFAULT 0 NOT NULL,
	"successful_events" integer DEFAULT 0 NOT NULL,
	"failed_events" integer DEFAULT 0 NOT NULL,
	"last_event_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"created_by" text,
	CONSTRAINT "email_integrations_org_id_email_address_key" UNIQUE("org_id","email_address")
);
--> statement-breakpoint
CREATE TABLE "event_monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source_id" text NOT NULL,
	"metric" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"message" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"visualization" jsonb,
	CONSTRAINT "event_monitors_severity_check" CHECK (severity = ANY (ARRAY['critical'::text, 'warning'::text, 'info'::text]))
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text,
	"user_id" text,
	"user_email" text,
	"feedback_type" "feedback_type" DEFAULT 'general' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"page_url" text,
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hosted_demos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_slug" text NOT NULL,
	"scenario" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_detail" text,
	"dashboard_id" uuid,
	"share_token" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "hosted_demos_prospect_slug_key" UNIQUE("prospect_slug"),
	CONSTRAINT "hosted_demos_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'stopping'::text, 'error'::text]))
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"channel" text NOT NULL,
	"integration_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"response_status" integer,
	"response_body" text,
	"response_time_ms" integer,
	"error" text,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_retry_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "notification_deliveries_channel_check" CHECK (channel = ANY (ARRAY['slack'::text, 'email'::text, 'pagerduty'::text])),
	CONSTRAINT "notification_deliveries_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'retrying'::text, 'delivered'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "org_billing" (
	"org_id" text PRIMARY KEY NOT NULL,
	"org_name" text,
	"tier" text DEFAULT 'tier_1' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_status" text,
	"enterprise_info" jsonb,
	"monthly_spend_cap_usd" numeric,
	"platform_fee_usd" numeric,
	"free_tier_revoked_key_ids" text[] DEFAULT '{}' NOT NULL,
	"spend_cap_revoked_key_ids" text[] DEFAULT '{}' NOT NULL,
	"high_burn_thresholds_alerted" jsonb,
	"free_tier_breach_email_sent_for_month" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_created_at" timestamp with time zone,
	"drip_markers" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'org:member' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "org_invites_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text,
	"first_name" text,
	"last_name" text,
	"role" text DEFAULT 'org:viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"image_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_members_pkey" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "pagerduty_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"service_name" text NOT NULL,
	"routing_key_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"events" text[] DEFAULT '{"alert.triggered","threshold.critical"}' NOT NULL,
	"default_severity" text DEFAULT 'critical' NOT NULL,
	"auto_resolve" boolean DEFAULT true NOT NULL,
	"total_events" integer DEFAULT 0 NOT NULL,
	"successful_events" integer DEFAULT 0 NOT NULL,
	"failed_events" integer DEFAULT 0 NOT NULL,
	"last_event_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"created_by" text,
	CONSTRAINT "pagerduty_integrations_org_id_name_key" UNIQUE("org_id","name")
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"camera_id" text NOT NULL,
	"gateway_api_key_id" uuid,
	"status" text DEFAULT 'requested' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"playback_url" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_leases" (
	"name" text PRIMARY KEY NOT NULL,
	"holder" text,
	"locked_until" timestamp with time zone DEFAULT to_timestamp((0)::double precision) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text NOT NULL,
	"webhook_url_encrypted" text NOT NULL,
	"access_token_encrypted" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"events" text[] DEFAULT '{"alert.triggered","device.offline"}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"created_by" text,
	"total_events" integer DEFAULT 0 NOT NULL,
	"successful_events" integer DEFAULT 0 NOT NULL,
	"failed_events" integer DEFAULT 0 NOT NULL,
	"last_event_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "slack_integrations_org_id_team_id_channel_id_key" UNIQUE("org_id","team_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "slack_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone DEFAULT (now() + '00:10:00'::interval),
	CONSTRAINT "slack_oauth_states_state_key" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE "source_associations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"table_schema" text,
	"filter_column" text,
	"filter_value" text,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"query_template" text,
	CONSTRAINT "source_associations_entity_type_check" CHECK (entity_type = ANY (ARRAY['device'::text, 'satellite'::text]))
);
--> statement-breakpoint
CREATE TABLE "source_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"context_type" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"file_url" text,
	"file_key" text,
	"file_size" integer,
	"mime_type" text,
	"link_url" text,
	"content" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "source_context_file_has_url" CHECK ((context_type <> 'file'::text) OR ((file_url IS NOT NULL) AND (file_key IS NOT NULL))),
	CONSTRAINT "source_context_link_has_url" CHECK ((context_type <> 'link'::text) OR (link_url IS NOT NULL)),
	CONSTRAINT "source_context_note_has_content" CHECK ((context_type <> 'note'::text) OR (content IS NOT NULL)),
	CONSTRAINT "source_context_valid_type" CHECK (context_type = ANY (ARRAY['file'::text, 'link'::text, 'note'::text]))
);
--> statement-breakpoint
CREATE TABLE "source_group_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"group_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"target_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb,
	"created_by" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "source_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"filter_criteria" jsonb DEFAULT '{}'::jsonb,
	"static_member_ids" uuid[] DEFAULT '{}',
	"color" text,
	"icon" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"source_types" text[]
);
--> statement-breakpoint
CREATE TABLE "source_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"min" double precision,
	"max" double precision,
	"severity" "alert_severity" DEFAULT 'warning' NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "source_limits_org_id_source_id_metric_key" UNIQUE("org_id","source_id","metric")
);
--> statement-breakpoint
CREATE TABLE "source_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source_id" uuid,
	"source_group_id" uuid,
	"user_id" text,
	"email" text,
	"team_id" uuid,
	"access_level" text DEFAULT 'view' NOT NULL,
	"invited_by" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text,
	CONSTRAINT "source_permissions_access_chk" CHECK (access_level = ANY (ARRAY['view'::text, 'edit'::text])),
	CONSTRAINT "source_permissions_grantee_present" CHECK ((user_id IS NOT NULL) OR (email IS NOT NULL) OR (team_id IS NOT NULL) OR (role IS NOT NULL)),
	CONSTRAINT "source_permissions_one_resource" CHECK ((source_id IS NOT NULL) <> (source_group_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source_type" text NOT NULL,
	"slug" text NOT NULL,
	"name" text,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_connected_at" timestamp with time zone,
	"last_error" text,
	"device_type" text,
	"connection_type" text,
	"credentials_encrypted" text,
	"config" jsonb DEFAULT '{"recording":false}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"health_score" integer,
	"tags" text[] DEFAULT '{}',
	"is_telemetry_store" boolean DEFAULT false NOT NULL,
	"ssh_credentials_encrypted" text,
	"visibility" text DEFAULT 'org' NOT NULL,
	"created_by" text,
	CONSTRAINT "sources_unique_org_slug" UNIQUE("org_id","slug"),
	CONSTRAINT "sources_telemetry_store_connection_only" CHECK ((is_telemetry_store = false) OR (source_type = 'connection'::text)),
	CONSTRAINT "sources_valid_status" CHECK (status = ANY (ARRAY['pending'::text, 'online'::text, 'offline'::text, 'error'::text])),
	CONSTRAINT "sources_valid_type" CHECK (source_type = ANY (ARRAY['device'::text, 'connection'::text, 'recording'::text, 'import'::text])),
	CONSTRAINT "sources_visibility_chk" CHECK (visibility = ANY (ARRAY['org'::text, 'restricted'::text]))
);
--> statement-breakpoint
CREATE TABLE "system_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"event_type" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"source_id" uuid,
	"source_name" text,
	"source_slug" text,
	"entity_id" text,
	"entity_type" text,
	"actor_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (((setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(description, ''::text)), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(source_name, ''::text)), 'C'::"char"))) STORED
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_pkey" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "team_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"action_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_permissions_unique" UNIQUE("org_id","team_id","action_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"icon" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terminal_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"period_start" date NOT NULL,
	"data_points_ingested" bigint DEFAULT 0 NOT NULL,
	"bytes_ingested" bigint DEFAULT 0 NOT NULL,
	"devices_active" integer DEFAULT 0 NOT NULL,
	"sessions_created" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "usage_org_id_period_start_key" UNIQUE("org_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "user_notification_state" (
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"alerts_last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_notification_state_pkey" PRIMARY KEY("user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"use_12_hour_format" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_settings_user_id_key" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"first_name" text,
	"last_name" text,
	"image_url" text,
	"is_staff" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"response_status" integer,
	"response_body" text,
	"response_time_ms" integer,
	"error" text,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_retry_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] DEFAULT '{}' NOT NULL,
	"source_filter" jsonb,
	"custom_headers" jsonb DEFAULT '{}'::jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"total_deliveries" integer DEFAULT 0 NOT NULL,
	"successful_deliveries" integer DEFAULT 0 NOT NULL,
	"failed_deliveries" integer DEFAULT 0 NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"secret_prefix" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_limit_id_fkey" FOREIGN KEY ("limit_id") REFERENCES "public"."source_limits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_permissions" ADD CONSTRAINT "dashboard_permissions_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_permissions" ADD CONSTRAINT "dashboard_permissions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_share_links" ADD CONSTRAINT "dashboard_share_links_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_views" ADD CONSTRAINT "dashboard_views_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_views" ADD CONSTRAINT "dashboard_views_share_link_id_fkey" FOREIGN KEY ("share_link_id") REFERENCES "public"."dashboard_share_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."dashboards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_auth_requests" ADD CONSTRAINT "device_auth_requests_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_associations" ADD CONSTRAINT "source_associations_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_context" ADD CONSTRAINT "source_context_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_group_commands" ADD CONSTRAINT "device_group_commands_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."source_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_limits" ADD CONSTRAINT "source_limits_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_permissions" ADD CONSTRAINT "source_permissions_source_group_id_fkey" FOREIGN KEY ("source_group_id") REFERENCES "public"."source_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_permissions" ADD CONSTRAINT "source_permissions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_permissions" ADD CONSTRAINT "source_permissions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_permissions" ADD CONSTRAINT "team_permissions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_overrides_org_id_idx" ON "access_overrides" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "alert_events_alert_id_idx" ON "alert_events" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "alert_events_created_at_idx" ON "alert_events" USING btree ("created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "alert_events_org_id_idx" ON "alert_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_alert_rules_org" ON "alert_rules" USING btree ("org_id") WHERE enabled;--> statement-breakpoint
CREATE INDEX "idx_alert_rules_org_source" ON "alert_rules" USING btree ("org_id","source_id") WHERE enabled;--> statement-breakpoint
CREATE INDEX "alerts_org_id_idx" ON "alerts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "alerts_org_status_idx" ON "alerts" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "alerts_org_triggered_idx" ON "alerts" USING btree ("org_id","triggered_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "alerts_severity_idx" ON "alerts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "alerts_source_id_idx" ON "alerts" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "alerts_status_idx" ON "alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "alerts_triggered_at_idx" ON "alerts" USING btree ("triggered_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_alerts_one_open_per_rule_source" ON "alerts" USING btree ("org_id","rule_id","source_id") WHERE ((status = 'open'::alert_status) AND (rule_id IS NOT NULL));--> statement-breakpoint
CREATE INDEX "idx_annotations_source_time" ON "annotations" USING btree ("org_id","source_id","timestamp_start");--> statement-breakpoint
CREATE INDEX "idx_annotations_time_range" ON "annotations" USING btree ("org_id","timestamp_start","timestamp_end") WHERE (timestamp_end IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_api_keys_hash" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "idx_api_keys_org_id" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_auth_accounts_user_id" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_user_id" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_column_metadata_source" ON "column_metadata" USING btree ("org_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_column_metadata_unique" ON "column_metadata" USING btree ("org_id","source_id","column_key");--> statement-breakpoint
CREATE INDEX "command_definitions_device_type_idx" ON "command_definitions" USING btree ("org_id","device_type") WHERE (device_type IS NOT NULL);--> statement-breakpoint
CREATE INDEX "command_definitions_org_id_idx" ON "command_definitions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_dashboard_icon_assets_org" ON "dashboard_icon_assets" USING btree ("org_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_dashboard_permissions_dashboard_id" ON "dashboard_permissions" USING btree ("dashboard_id");--> statement-breakpoint
CREATE INDEX "idx_dashboard_permissions_email" ON "dashboard_permissions" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_dashboard_permissions_org_id" ON "dashboard_permissions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_dashboard_permissions_role" ON "dashboard_permissions" USING btree ("org_id","role");--> statement-breakpoint
CREATE INDEX "idx_dashboard_permissions_team_id" ON "dashboard_permissions" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_dashboard_permissions_unique" ON "dashboard_permissions" USING btree (dashboard_id,COALESCE(user_id, ''::text),COALESCE(email, ''::text),COALESCE((team_id)::text, ''::text),COALESCE(role, ''::text));--> statement-breakpoint
CREATE INDEX "idx_dashboard_permissions_user_id" ON "dashboard_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_dashboard_share_links_dashboard_id" ON "dashboard_share_links" USING btree ("dashboard_id");--> statement-breakpoint
CREATE INDEX "idx_dashboard_share_links_org_id" ON "dashboard_share_links" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_dashboard_share_links_token" ON "dashboard_share_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_dashboard_views_dashboard_id" ON "dashboard_views" USING btree ("dashboard_id");--> statement-breakpoint
CREATE INDEX "idx_dashboard_views_org_id" ON "dashboard_views" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_dashboard_views_session_id" ON "dashboard_views" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_dashboard_views_share_link_id" ON "dashboard_views" USING btree ("share_link_id");--> statement-breakpoint
CREATE INDEX "idx_dashboard_views_started_at" ON "dashboard_views" USING btree ("org_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_dashboards_org_id" ON "dashboards" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_dashboards_parent_id" ON "dashboards" USING btree ("org_id","parent_id");--> statement-breakpoint
CREATE INDEX "idx_device_auth_expires" ON "device_auth_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_device_auth_user_code" ON "device_auth_requests" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "idx_device_schemas_source" ON "device_schemas" USING btree ("org_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_device_schemas_unique" ON "device_schemas" USING btree ("org_id","source_id","metric");--> statement-breakpoint
CREATE INDEX "email_integrations_enabled_idx" ON "email_integrations" USING btree ("org_id","enabled") WHERE (enabled = true);--> statement-breakpoint
CREATE INDEX "email_integrations_org_id_idx" ON "email_integrations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_event_monitors_enabled" ON "event_monitors" USING btree ("org_id","enabled") WHERE (enabled = true);--> statement-breakpoint
CREATE INDEX "idx_event_monitors_source" ON "event_monitors" USING btree ("org_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_event_monitors_unique" ON "event_monitors" USING btree ("org_id","source_id","metric");--> statement-breakpoint
CREATE INDEX "idx_feedback_created_at" ON "feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_feedback_org_id" ON "feedback" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_feedback_type" ON "feedback" USING btree ("feedback_type");--> statement-breakpoint
CREATE INDEX "idx_feedback_user_id" ON "feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_hosted_demos_status" ON "hosted_demos" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notification_deliveries_integration_idx" ON "notification_deliveries" USING btree ("org_id","integration_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "notification_deliveries_org_created_idx" ON "notification_deliveries" USING btree ("org_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "notification_deliveries_pending_retry_idx" ON "notification_deliveries" USING btree ("status","next_retry_at") WHERE (status = ANY (ARRAY['pending'::text, 'retrying'::text]));--> statement-breakpoint
CREATE INDEX "idx_org_invites_org_id" ON "org_invites" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_org_members_org_role" ON "org_members" USING btree ("org_id","role");--> statement-breakpoint
CREATE INDEX "idx_org_members_user_id" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pagerduty_integrations_enabled_idx" ON "pagerduty_integrations" USING btree ("org_id","enabled") WHERE (enabled = true);--> statement-breakpoint
CREATE INDEX "pagerduty_integrations_org_id_idx" ON "pagerduty_integrations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "recordings_expires_idx" ON "recordings" USING btree ("expires_at") WHERE (status = ANY (ARRAY['requested'::text, 'recording'::text]));--> statement-breakpoint
CREATE INDEX "recordings_org_status_idx" ON "recordings" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "slack_integrations_enabled_idx" ON "slack_integrations" USING btree ("org_id","enabled") WHERE (enabled = true);--> statement-breakpoint
CREATE INDEX "slack_integrations_org_id_idx" ON "slack_integrations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "slack_integrations_team_id_idx" ON "slack_integrations" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "slack_oauth_states_expires_idx" ON "slack_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "slack_oauth_states_state_idx" ON "slack_oauth_states" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_source_assoc_connection" ON "source_associations" USING btree ("org_id","connection_id");--> statement-breakpoint
CREATE INDEX "idx_source_assoc_entity" ON "source_associations" USING btree ("org_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_source_assoc_unique" ON "source_associations" USING btree ("org_id","entity_id","connection_id","table_name");--> statement-breakpoint
CREATE INDEX "idx_source_context_org" ON "source_context" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_source_context_source" ON "source_context" USING btree ("org_id","source_id");--> statement-breakpoint
CREATE INDEX "idx_source_context_type" ON "source_context" USING btree ("org_id","source_id","context_type");--> statement-breakpoint
CREATE INDEX "device_group_commands_created_at_idx" ON "source_group_commands" USING btree ("org_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "device_group_commands_group_id_idx" ON "source_group_commands" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "device_group_commands_org_id_idx" ON "source_group_commands" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "device_group_commands_status_idx" ON "source_group_commands" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "device_groups_name_idx" ON "source_groups" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "device_groups_org_id_idx" ON "source_groups" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_source_limits_org_source" ON "source_limits" USING btree ("org_id","source_id");--> statement-breakpoint
CREATE INDEX "idx_source_limits_source_id" ON "source_limits" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_source_permissions_group" ON "source_permissions" USING btree ("source_group_id");--> statement-breakpoint
CREATE INDEX "idx_source_permissions_org" ON "source_permissions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_source_permissions_role" ON "source_permissions" USING btree ("org_id","role");--> statement-breakpoint
CREATE INDEX "idx_source_permissions_source" ON "source_permissions" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_source_permissions_team" ON "source_permissions" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_source_permissions_unique" ON "source_permissions" USING btree (COALESCE((source_id)::text, ''::text),COALESCE((source_group_id)::text, ''::text),COALESCE(user_id, ''::text),COALESCE(email, ''::text),COALESCE((team_id)::text, ''::text),COALESCE(role, ''::text));--> statement-breakpoint
CREATE INDEX "idx_source_permissions_user" ON "source_permissions" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_sources_connection_type" ON "sources" USING btree ("org_id","connection_type") WHERE (source_type = 'connection'::text);--> statement-breakpoint
CREATE INDEX "idx_sources_last_seen" ON "sources" USING btree ("org_id","last_seen_at" DESC NULLS LAST) WHERE (source_type = 'device'::text);--> statement-breakpoint
CREATE INDEX "idx_sources_org_id" ON "sources" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_sources_org_slug" ON "sources" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "idx_sources_org_status" ON "sources" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "idx_sources_org_type" ON "sources" USING btree ("org_id","source_type");--> statement-breakpoint
CREATE INDEX "idx_sources_telemetry_store" ON "sources" USING btree ("org_id","is_telemetry_store") WHERE (is_telemetry_store = true);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sources_telemetry_store_unique" ON "sources" USING btree ("org_id") WHERE (is_telemetry_store = true);--> statement-breakpoint
CREATE INDEX "sources_device_type_idx" ON "sources" USING btree ("org_id","device_type");--> statement-breakpoint
CREATE INDEX "sources_health_score_idx" ON "sources" USING btree ("org_id","health_score");--> statement-breakpoint
CREATE INDEX "sources_tags_idx" ON "sources" USING gin ("tags" array_ops);--> statement-breakpoint
CREATE INDEX "idx_system_events_org_category" ON "system_events" USING btree ("org_id","category","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_system_events_org_created" ON "system_events" USING btree ("org_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_system_events_org_severity" ON "system_events" USING btree ("org_id","severity","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_system_events_org_source" ON "system_events" USING btree ("org_id","source_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_system_events_org_type" ON "system_events" USING btree ("org_id","event_type","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_system_events_search" ON "system_events" USING gin ("search_vector" tsvector_ops);--> statement-breakpoint
CREATE INDEX "idx_team_members_org_id" ON "team_members" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_team_members_user_id" ON "team_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_team_permissions_org_team" ON "team_permissions" USING btree ("org_id","team_id");--> statement-breakpoint
CREATE INDEX "idx_teams_org_id" ON "teams" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "terminal_conversations_org_user_idx" ON "terminal_conversations" USING btree ("org_id","user_id","updated_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_usage_org_id" ON "usage" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_usage_period" ON "usage" USING btree ("org_id","period_start" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "user_notification_state_org_id_idx" ON "user_notification_state" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_user_settings_user_id" ON "user_settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower(email));--> statement-breakpoint
CREATE INDEX "webhook_deliveries_created_at_idx" ON "webhook_deliveries" USING btree ("org_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "webhook_deliveries_event_type_idx" ON "webhook_deliveries" USING btree ("org_id","event_type");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_org_id_idx" ON "webhook_deliveries" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_pending_retry_idx" ON "webhook_deliveries" USING btree ("status","next_retry_at") WHERE ((status = 'pending'::text) OR (status = 'retrying'::text));--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_webhook_id_idx" ON "webhook_deliveries" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "webhooks_enabled_idx" ON "webhooks" USING btree ("org_id","enabled");--> statement-breakpoint
CREATE INDEX "webhooks_events_idx" ON "webhooks" USING gin ("events" array_ops);--> statement-breakpoint
CREATE INDEX "webhooks_org_id_idx" ON "webhooks" USING btree ("org_id");--> statement-breakpoint
CREATE VIEW "public"."usage_monthly" WITH (security_invoker = true) AS (SELECT org_id, date_trunc('month'::text, period_start::timestamp with time zone) AS month, sum(data_points_ingested) AS total_data_points, sum(bytes_ingested) AS total_bytes, max(devices_active) AS peak_devices, sum(sessions_created) AS total_sessions FROM usage GROUP BY org_id, (date_trunc('month'::text, period_start::timestamp with time zone)));