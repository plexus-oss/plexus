/**
 * Database Types - Single Source of Truth
 *
 * All database-related types are defined here. Do NOT define types elsewhere.
 * This file consolidates types from:
 * - Supabase schema types
 * - ClickHouse telemetry types
 * - Plexus table types
 */

// =============================================================================
// BASE TYPES
// =============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// =============================================================================
// ENUMS
// =============================================================================

export type DataSourceType =
  | "postgres"
  | "timescaledb"
  | "clickhouse"
  | "influxdb"
  | "prometheus"
  | "mysql";
export type DataSourceStatus = "pending" | "connected" | "error";
export type AnnotationSourceType = "device" | "external" | "table";

// Source types (unified model)
export type SourceType = "device" | "connection";
export type SourceStatus = "pending" | "online" | "offline" | "error";
export type ConnectionType =
  | "postgres"
  | "timescaledb"
  | "clickhouse"
  | "influxdb"
  | "prometheus"
  | "mysql";

// Context types (attachments for sources)
export type SourceContextType = "file" | "link" | "note";

// Limit severity levels
export type LimitSeverity = "critical" | "warning" | "info";

// Dashboard sharing types
export type ShareLinkAccess = "view" | "edit";
export type ShareLinkStatus = "active" | "expired" | "revoked";

// Feedback types
export type FeedbackType = "bug" | "feature" | "general";

// Alert types
export type AlertTriggerType = "limit_violation" | "event" | "alert_rule";
export type AlertStatus = "open" | "acknowledged" | "resolved";
export type AlertEventType =
  | "created"
  | "acknowledged"
  | "resolved"
  | "reopened"
  | "comment"
  | "triggered"
  | "verdict";

// On-call judgment of whether an alert was worth firing — the training signal
// for default-silence. Lives on the alert (current_verdict) and as a typed
// `verdict` event in alert_events; rolls up to the rule/limit that fired.
export type AlertVerdict = "helpful" | "noise";

// Recency-windowed verdict rollup for an alert's rule/limit on a given source.
// Read live at panel-open (see alertQueries.getVerdictStats).
export interface VerdictStats {
  helpful: number;
  noise: number;
  total: number;
}

// Alert rule types (alert-service integration)
export type AlertRuleType = "threshold" | "outlier" | "compound" | "offline";
export type AlertRuleOperator = "and" | "or";

// System event types
export type SystemEventType =
  | "device.online"
  | "device.offline"
  | "device.created"
  | "device.deleted"
  | "connection.created"
  | "connection.deleted"
  | "source.updated"
  | "source.limits_configured"
  | "alert.triggered"
  | "alert.resolved"
  | "alert.acknowledged"
  | "alert.silenced"
  | "device.command_sent"
  | "dashboard.created"
  | "dashboard.deleted"
  | "dashboard.duplicated"
  | "dashboard.shared"
  | "dashboard.unshared"
  | "webhook.created"
  | "webhook.deleted"
  | "integration.slack_connected"
  | "integration.slack_disconnected"
  | "integration.email_connected"
  | "integration.email_disconnected"
  | "api_key.created"
  | "api_key.revoked"
  | "group.created"
  | "group.deleted"
  | "member.invited"
  | "member.removed"
  | "member.role_changed"
  | "member.scope_changed"
  | "feedback.submitted";

export type SystemEventCategory =
  | "device"
  | "alert"
  | "source"
  | "dashboard"
  | "webhook"
  | "integration"
  | "api_key"
  | "group"
  | "member"
  | "feedback";

export type SystemEventSeverity = "info" | "warning" | "critical" | "success";

// Webhook event types
export type WebhookEventType =
  | "alert.triggered"
  | "alert.resolved"
  | "alert.acknowledged"
  | "alert.silenced"
  | "device.command_sent"
  | "device.online"
  | "device.offline"
  | "threshold.warning"
  | "threshold.critical";

// Webhook delivery status
export type WebhookDeliveryStatus =
  | "pending"
  | "delivered"
  | "failed"
  | "retrying";

// Notification delivery channel (integration notifications)
export type NotificationChannel = "slack" | "email";

// Slack integration types
export type SlackIntegrationEvent = WebhookEventType;

// =============================================================================
// SLACK INTEGRATION TYPES
// =============================================================================

export interface SlackIntegration {
  id: string;
  org_id: string;
  team_id: string;
  team_name: string;
  channel_id: string;
  channel_name: string;
  webhook_url_encrypted: string;
  access_token_encrypted: string | null;
  enabled: boolean;
  events: SlackIntegrationEvent[];
  total_events: number;
  successful_events: number;
  failed_events: number;
  last_event_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface NewSlackIntegration {
  org_id: string;
  team_id: string;
  team_name: string;
  channel_id: string;
  channel_name: string;
  webhook_url_encrypted: string;
  access_token_encrypted?: string | null;
  enabled?: boolean;
  events?: SlackIntegrationEvent[];
  created_by?: string | null;
}

export interface UpdateSlackIntegration {
  enabled?: boolean;
  events?: SlackIntegrationEvent[];
}

// Public-safe version (no encrypted fields)
export interface SlackIntegrationPublic {
  id: string;
  org_id: string;
  team_id: string;
  team_name: string;
  channel_id: string;
  channel_name: string;
  enabled: boolean;
  events: SlackIntegrationEvent[];
  total_events: number;
  successful_events: number;
  failed_events: number;
  last_event_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SlackOAuthState {
  id: string;
  org_id: string;
  user_id: string;
  state: string;
  created_at: string;
  expires_at: string;
}

// =============================================================================
// EMAIL INTEGRATION TYPES
// =============================================================================

export interface EmailIntegration {
  id: string;
  org_id: string;
  name: string;
  email_address: string;
  enabled: boolean;
  events: WebhookEventType[];
  total_events: number;
  successful_events: number;
  failed_events: number;
  last_event_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface NewEmailIntegration {
  org_id: string;
  name: string;
  email_address: string;
  enabled?: boolean;
  events?: WebhookEventType[];
  created_by?: string | null;
}

export interface UpdateEmailIntegration {
  name?: string;
  email_address?: string;
  enabled?: boolean;
  events?: WebhookEventType[];
}

export type EmailIntegrationPublic = Omit<EmailIntegration, "created_by">;

// =============================================================================
// COLUMN & LIMIT TYPES
// =============================================================================

export type PlexusColumnType =
  | "string"
  | "number"
  | "boolean"
  | "timestamp"
  | "date"
  | "json"
  | "uuid";

export type ColumnLimit = {
  min?: number;
  max?: number;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  allowedValues?: string[];
  severity: string;
  message?: string;
};

export type PlexusColumn = {
  name: string;
  type: PlexusColumnType;
  nullable?: boolean;
  limit?: ColumnLimit;
};

// =============================================================================
// TELEMETRY TYPES (ClickHouse)
// =============================================================================

export interface TelemetryRow {
  id?: string;
  org_id: string;
  source_id: string;
  metric: string;
  value: number;
  value_string?: string | null;
  value_json?: string | null;
  timestamp: Date | string;
  tags?: Record<string, string>;
  retention_until?: Date | string;
}

export interface TelemetryRowWithId extends Omit<TelemetryRow, "id"> {
  id: string;
}

export type TelemetryLimit = {
  min?: number;
  max?: number;
  severity: string;
  message?: string;
};

// =============================================================================
// DATABASE INTERFACE (legacy hand-written table types; Supabase is retired —
// full Drizzle $inferSelect migration is deferred, see AGENTS.md)
// =============================================================================

export interface Database {
  public: {
    Tables: {
      terminal_conversations: {
        Row: {
          id: string;
          org_id: string;
          user_id: string;
          title: string;
          messages: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          user_id: string;
          title: string;
          messages?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          user_id?: string;
          title?: string;
          messages?: Json;
          created_at?: string;
          updated_at?: string;
        };
      };
      org_billing: {
        Row: {
          org_id: string;
          org_name: string | null;
          logo_url: string | null;
          org_created_at: string | null;
          tier: string;
          stripe_customer_id: string | null;
          stripe_subscription_status: string | null;
          enterprise_info: Json | null;
          monthly_spend_cap_usd: number | null;
          platform_fee_usd: number | null;
          free_tier_revoked_key_ids: string[];
          spend_cap_revoked_key_ids: string[];
          high_burn_thresholds_alerted: Json | null;
          free_tier_breach_email_sent_for_month: string | null;
          drip_markers: Json;
          updated_at: string;
        };
        Insert: {
          org_id: string;
          org_name?: string | null;
          logo_url?: string | null;
          org_created_at?: string | null;
          tier?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_status?: string | null;
          enterprise_info?: Json | null;
          monthly_spend_cap_usd?: number | null;
          platform_fee_usd?: number | null;
          free_tier_revoked_key_ids?: string[];
          spend_cap_revoked_key_ids?: string[];
          high_burn_thresholds_alerted?: Json | null;
          free_tier_breach_email_sent_for_month?: string | null;
          drip_markers?: Json;
          updated_at?: string;
        };
        Update: {
          org_id?: string;
          org_name?: string | null;
          logo_url?: string | null;
          org_created_at?: string | null;
          tier?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_status?: string | null;
          enterprise_info?: Json | null;
          monthly_spend_cap_usd?: number | null;
          platform_fee_usd?: number | null;
          free_tier_revoked_key_ids?: string[];
          spend_cap_revoked_key_ids?: string[];
          high_burn_thresholds_alerted?: Json | null;
          free_tier_breach_email_sent_for_month?: string | null;
          drip_markers?: Json;
          updated_at?: string;
        };
      };
      users: {
        Row: {
          id: string;
          email: string;
          email_verified: string | null;
          first_name: string | null;
          last_name: string | null;
          image_url: string | null;
          is_staff: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          email_verified?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          image_url?: string | null;
          is_staff?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          email_verified?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          image_url?: string | null;
          is_staff?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      auth_sessions: {
        Row: {
          session_token: string;
          user_id: string;
          expires: string;
        };
        Insert: {
          session_token: string;
          user_id: string;
          expires: string;
        };
        Update: {
          session_token?: string;
          user_id?: string;
          expires?: string;
        };
      };
      auth_accounts: {
        Row: {
          provider: string;
          provider_account_id: string;
          user_id: string;
          type: string;
          access_token: string | null;
          refresh_token: string | null;
          expires_at: number | null;
          token_type: string | null;
          scope: string | null;
          id_token: string | null;
          session_state: string | null;
        };
        Insert: {
          provider: string;
          provider_account_id: string;
          user_id: string;
          type: string;
          access_token?: string | null;
          refresh_token?: string | null;
          expires_at?: number | null;
          token_type?: string | null;
          scope?: string | null;
          id_token?: string | null;
          session_state?: string | null;
        };
        Update: {
          provider?: string;
          provider_account_id?: string;
          user_id?: string;
          type?: string;
          access_token?: string | null;
          refresh_token?: string | null;
          expires_at?: number | null;
          token_type?: string | null;
          scope?: string | null;
          id_token?: string | null;
          session_state?: string | null;
        };
      };
      auth_verification_tokens: {
        Row: {
          identifier: string;
          token: string;
          expires: string;
        };
        Insert: {
          identifier: string;
          token: string;
          expires: string;
        };
        Update: {
          identifier?: string;
          token?: string;
          expires?: string;
        };
      };
      org_invites: {
        Row: {
          id: string;
          org_id: string;
          email: string;
          role: string;
          token_hash: string;
          invited_by: string | null;
          created_at: string;
          expires_at: string;
          accepted_at: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          email: string;
          role?: string;
          token_hash: string;
          invited_by?: string | null;
          created_at?: string;
          expires_at: string;
          accepted_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          email?: string;
          role?: string;
          token_hash?: string;
          invited_by?: string | null;
          created_at?: string;
          expires_at?: string;
          accepted_at?: string | null;
        };
      };
      org_members: {
        Row: {
          org_id: string;
          user_id: string;
          email: string | null;
          first_name: string | null;
          last_name: string | null;
          image_url: string | null;
          role: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          org_id: string;
          user_id: string;
          email?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          image_url?: string | null;
          role?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          org_id?: string;
          user_id?: string;
          email?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          image_url?: string | null;
          role?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      data_sources: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          type: string;
          config: Json;
          credentials_encrypted: string | null;
          status: string;
          last_connected_at: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          type: string;
          config: Json;
          credentials_encrypted?: string | null;
          status?: DataSourceStatus;
          last_connected_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          type?: DataSourceType;
          config?: Json;
          credentials_encrypted?: string | null;
          status?: DataSourceStatus;
          last_connected_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      annotations: {
        Row: {
          id: string;
          org_id: string;
          source_type: string;
          source_id: string | null;
          telemetry_id: string | null;
          timestamp_start: string;
          timestamp_end: string | null;
          metric_name: string | null;
          value_snapshot: Json | null;
          label: string;
          notes: string | null;
          color: string | null;
          run_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          source_type: string;
          source_id?: string | null;
          telemetry_id?: string | null;
          timestamp_start: string;
          timestamp_end?: string | null;
          metric_name?: string | null;
          value_snapshot?: Json | null;
          label: string;
          notes?: string | null;
          color?: string | null;
          run_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          source_type?: AnnotationSourceType;
          source_id?: string | null;
          telemetry_id?: string | null;
          timestamp_start?: string;
          timestamp_end?: string | null;
          metric_name?: string | null;
          value_snapshot?: Json | null;
          label?: string;
          notes?: string | null;
          color?: string | null;
          run_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      api_keys: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          key_hash: string;
          key_prefix: string;
          scopes: string[] | null;
          last_used_at: string | null;
          expires_at: string | null;
          created_at: string;
          // Migration 00042 — gates ingest based on billing state
          // (set false when card removed / subscription canceled).
          access_enabled: boolean;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          key_hash: string;
          key_prefix: string;
          scopes?: string[] | null;
          last_used_at?: string | null;
          expires_at?: string | null;
          created_at?: string;
          access_enabled?: boolean;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          key_hash?: string;
          key_prefix?: string;
          scopes?: string[] | null;
          last_used_at?: string | null;
          expires_at?: string | null;
          created_at?: string;
          access_enabled?: boolean;
        };
      };
      dashboard_icon_assets: {
        Row: {
          id: string;
          org_id: string;
          url: string;
          storage_path: string;
          file_name: string | null;
          content_type: string | null;
          size_bytes: number | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          url: string;
          storage_path: string;
          file_name?: string | null;
          content_type?: string | null;
          size_bytes?: number | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          url?: string;
          storage_path?: string;
          file_name?: string | null;
          content_type?: string | null;
          size_bytes?: number | null;
          created_by?: string | null;
          created_at?: string;
        };
      };
      dashboards: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          description: string | null;
          icon: string | null;
          icon_url: string | null;
          config: Json;
          parent_id: string | null;
          visibility: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          description?: string | null;
          icon?: string | null;
          icon_url?: string | null;
          config: Json;
          parent_id?: string | null;
          visibility?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          description?: string | null;
          icon?: string | null;
          icon_url?: string | null;
          config?: Json;
          parent_id?: string | null;
          visibility?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      user_settings: {
        Row: {
          id: string;
          user_id: string;
          timezone: string;
          use_12_hour_format: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          timezone?: string;
          use_12_hour_format?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          timezone?: string;
          use_12_hour_format?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };

      user_notification_state: {
        Row: {
          user_id: string;
          org_id: string;
          alerts_last_seen_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          org_id: string;
          alerts_last_seen_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          org_id?: string;
          alerts_last_seen_at?: string;
          updated_at?: string;
        };
      };

      org_roles: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          base_role: string;
          description: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          base_role?: string;
          description?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          base_role?: string;
          description?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };

      org_role_permissions: {
        Row: {
          org_id: string;
          role_id: string;
          action_id: string;
          allowed: boolean;
        };
        Insert: {
          org_id: string;
          role_id: string;
          action_id: string;
          allowed: boolean;
        };
        Update: {
          org_id?: string;
          role_id?: string;
          action_id?: string;
          allowed?: boolean;
        };
      };

      plexus_tables: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          description: string | null;
          columns: Json;
          row_count: number;
          source_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          description?: string | null;
          columns: Json;
          row_count?: number;
          source_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          description?: string | null;
          columns?: Json;
          row_count?: number;
          source_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      plexus_table_rows: {
        Row: {
          id: string;
          org_id: string;
          table_id: string;
          data: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          table_id: string;
          data: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          table_id?: string;
          data?: Json;
          created_at?: string;
          updated_at?: string;
        };
      };
      sources: {
        Row: {
          id: string;
          org_id: string;
          source_type: SourceType;
          slug: string;
          name: string | null;
          description: string | null;
          status: SourceStatus;
          last_seen_at: string | null;
          last_connected_at: string | null;
          last_error: string | null;
          device_type: string | null;

          connection_type: ConnectionType | null;
          credentials_encrypted: string | null;
          ssh_credentials_encrypted: string | null;
          config: Json;
          metadata: Json;
          visibility: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          source_type: SourceType;
          slug: string;
          name?: string | null;
          description?: string | null;
          status?: SourceStatus;
          last_seen_at?: string | null;
          last_connected_at?: string | null;
          last_error?: string | null;
          device_type?: string | null;

          connection_type?: ConnectionType | null;
          credentials_encrypted?: string | null;
          ssh_credentials_encrypted?: string | null;
          config?: Json;
          metadata?: Json;
          visibility?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          source_type?: SourceType;
          slug?: string;
          name?: string | null;
          description?: string | null;
          status?: SourceStatus;
          last_seen_at?: string | null;
          last_connected_at?: string | null;
          last_error?: string | null;
          device_type?: string | null;

          connection_type?: ConnectionType | null;
          credentials_encrypted?: string | null;
          ssh_credentials_encrypted?: string | null;
          config?: Json;
          metadata?: Json;
          visibility?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };

      source_permissions: {
        Row: {
          id: string;
          org_id: string;
          source_id: string | null;
          source_group_id: string | null;
          user_id: string | null;
          email: string | null;
          role: string | null;
          access_level: ShareLinkAccess;
          invited_by: string | null;
          accepted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          source_id?: string | null;
          source_group_id?: string | null;
          user_id?: string | null;
          email?: string | null;
          role?: string | null;
          access_level?: ShareLinkAccess;
          invited_by?: string | null;
          accepted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          source_id?: string | null;
          source_group_id?: string | null;
          user_id?: string | null;
          email?: string | null;
          role?: string | null;
          access_level?: ShareLinkAccess;
          invited_by?: string | null;
          accepted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };

      source_context: {
        Row: {
          id: string;
          org_id: string;
          source_id: string;
          context_type: SourceContextType;
          name: string;
          description: string | null;
          file_url: string | null;
          file_key: string | null;
          file_size: number | null;
          mime_type: string | null;
          link_url: string | null;
          content: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          source_id: string;
          context_type: SourceContextType;
          name: string;
          description?: string | null;
          file_url?: string | null;
          file_key?: string | null;
          file_size?: number | null;
          mime_type?: string | null;
          link_url?: string | null;
          content?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          source_id?: string;
          context_type?: SourceContextType;
          name?: string;
          description?: string | null;
          file_url?: string | null;
          file_key?: string | null;
          file_size?: number | null;
          mime_type?: string | null;
          link_url?: string | null;
          content?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      source_limits: {
        Row: {
          id: string;
          org_id: string;
          source_id: string;
          metric: string;
          min: number | null;
          max: number | null;
          severity: LimitSeverity;
          message: string | null;
          silenced_until: string | null;
          table_name: string | null;
          time_column: string | null;
          poll_watermark: string | null;
          last_polled_at: string | null;
          last_status: string | null;
          last_error: string | null;
          last_evaluated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          source_id: string;
          metric: string;
          min?: number | null;
          max?: number | null;
          severity?: LimitSeverity;
          message?: string | null;
          silenced_until?: string | null;
          table_name?: string | null;
          time_column?: string | null;
          poll_watermark?: string | null;
          last_polled_at?: string | null;
          last_status?: string | null;
          last_error?: string | null;
          last_evaluated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          source_id?: string;
          metric?: string;
          min?: number | null;
          max?: number | null;
          severity?: LimitSeverity;
          message?: string | null;
          silenced_until?: string | null;
          table_name?: string | null;
          time_column?: string | null;
          poll_watermark?: string | null;
          last_polled_at?: string | null;
          last_status?: string | null;
          last_error?: string | null;
          last_evaluated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      dashboard_share_links: {
        Row: {
          id: string;
          org_id: string;
          dashboard_id: string;
          token: string;
          name: string | null;
          access_level: ShareLinkAccess;
          status: ShareLinkStatus;
          password_hash: string | null;
          expires_at: string | null;
          max_views: number | null;
          view_count: number;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          dashboard_id: string;
          token: string;
          name?: string | null;
          access_level?: ShareLinkAccess;
          status?: ShareLinkStatus;
          password_hash?: string | null;
          expires_at?: string | null;
          max_views?: number | null;
          view_count?: number;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          dashboard_id?: string;
          token?: string;
          name?: string | null;
          access_level?: ShareLinkAccess;
          status?: ShareLinkStatus;
          password_hash?: string | null;
          expires_at?: string | null;
          max_views?: number | null;
          view_count?: number;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      dashboard_views: {
        Row: {
          id: string;
          org_id: string;
          dashboard_id: string;
          share_link_id: string | null;
          viewer_id: string | null;
          session_id: string;
          ip_address: string | null;
          user_agent: string | null;
          referrer: string | null;
          country: string | null;
          city: string | null;
          duration_seconds: number | null;
          panels_viewed: Json | null;
          started_at: string;
          ended_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          dashboard_id: string;
          share_link_id?: string | null;
          viewer_id?: string | null;
          session_id: string;
          ip_address?: string | null;
          user_agent?: string | null;
          referrer?: string | null;
          country?: string | null;
          city?: string | null;
          duration_seconds?: number | null;
          panels_viewed?: Json | null;
          started_at?: string;
          ended_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          dashboard_id?: string;
          share_link_id?: string | null;
          viewer_id?: string | null;
          session_id?: string;
          ip_address?: string | null;
          user_agent?: string | null;
          referrer?: string | null;
          country?: string | null;
          city?: string | null;
          duration_seconds?: number | null;
          panels_viewed?: Json | null;
          started_at?: string;
          ended_at?: string | null;
          created_at?: string;
        };
      };
      dashboard_permissions: {
        Row: {
          id: string;
          org_id: string;
          dashboard_id: string;
          user_id: string | null;
          email: string | null;
          role: string | null;
          access_level: ShareLinkAccess;
          invited_by: string;
          accepted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          dashboard_id: string;
          user_id?: string | null;
          email?: string | null;
          role?: string | null;
          access_level?: ShareLinkAccess;
          invited_by: string;
          accepted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          dashboard_id?: string;
          user_id?: string | null;
          email?: string | null;
          role?: string | null;
          access_level?: ShareLinkAccess;
          invited_by?: string;
          accepted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      feedback: {
        Row: {
          id: string;
          org_id: string | null;
          user_id: string | null;
          user_email: string | null;
          feedback_type: FeedbackType;
          title: string;
          message: string;
          page_url: string | null;
          user_agent: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id?: string | null;
          user_id?: string | null;
          user_email?: string | null;
          feedback_type?: FeedbackType;
          title: string;
          message: string;
          page_url?: string | null;
          user_agent?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string | null;
          user_id?: string | null;
          user_email?: string | null;
          feedback_type?: FeedbackType;
          title?: string;
          message?: string;
          page_url?: string | null;
          user_agent?: string | null;
          metadata?: Json;
          created_at?: string;
        };
      };
      alerts: {
        Row: {
          id: string;
          org_id: string;
          source_id: string | null;
          trigger_type: AlertTriggerType;
          metric: string;
          value: number;
          threshold: number | null;
          bound: string | null;
          severity: LimitSeverity;
          status: AlertStatus;
          is_alert_active: boolean;
          recommended_actions: Json;
          alert_stats: Json;
          context_snapshot: Json;
          current_verdict: AlertVerdict | null;
          closed_at: string | null;
          limit_id: string | null;
          rule_id: string | null;
          triggered_at: string;
          acknowledged_at: string | null;
          acknowledged_by: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          resolution_notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          source_id?: string | null;
          trigger_type: AlertTriggerType;
          metric: string;
          value: number;
          threshold?: number | null;
          bound?: string | null;
          severity?: LimitSeverity;
          status?: AlertStatus;
          is_alert_active?: boolean;
          recommended_actions?: Json;
          alert_stats?: Json;
          context_snapshot?: Json;
          current_verdict?: AlertVerdict | null;
          closed_at?: string | null;
          limit_id?: string | null;
          rule_id?: string | null;
          triggered_at?: string;
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          resolution_notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          source_id?: string | null;
          trigger_type?: AlertTriggerType;
          metric?: string;
          value?: number;
          threshold?: number | null;
          bound?: string | null;
          severity?: LimitSeverity;
          status?: AlertStatus;
          is_alert_active?: boolean;
          recommended_actions?: Json;
          alert_stats?: Json;
          context_snapshot?: Json;
          current_verdict?: AlertVerdict | null;
          closed_at?: string | null;
          limit_id?: string | null;
          rule_id?: string | null;
          triggered_at?: string;
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          resolution_notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      alert_events: {
        Row: {
          id: string;
          org_id: string;
          alert_id: string;
          event_type: AlertEventType;
          actor_id: string | null;
          message: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          alert_id: string;
          event_type: AlertEventType;
          actor_id?: string | null;
          message?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          alert_id?: string;
          event_type?: AlertEventType;
          actor_id?: string | null;
          message?: string | null;
          metadata?: Json;
          created_at?: string;
        };
      };
      alert_rules: {
        Row: {
          id: string;
          org_id: string;
          source_id: string;
          type: AlertRuleType;
          metric: string | null;
          conditions: Json;
          operator: AlertRuleOperator | null;
          sub_rules: Json | null;
          hysteresis_seconds: number | null;
          cooldown_seconds: number | null;
          silenced_until: string | null;
          severity: string;
          enabled: boolean;
          notification_target_ids: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          source_id: string;
          type: AlertRuleType;
          metric?: string | null;
          conditions?: Json;
          operator?: AlertRuleOperator | null;
          sub_rules?: Json | null;
          hysteresis_seconds?: number | null;
          cooldown_seconds?: number | null;
          silenced_until?: string | null;
          severity?: string;
          enabled?: boolean;
          notification_target_ids?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          source_id?: string;
          type?: AlertRuleType;
          metric?: string | null;
          conditions?: Json;
          operator?: AlertRuleOperator | null;
          sub_rules?: Json | null;
          hysteresis_seconds?: number | null;
          cooldown_seconds?: number | null;
          silenced_until?: string | null;
          severity?: string;
          enabled?: boolean;
          notification_target_ids?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      source_groups: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          description: string | null;
          filter_criteria: Json;
          static_member_ids: string[];
          color: string | null;
          icon: string | null;
          source_types: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          description?: string | null;
          filter_criteria?: Json;
          static_member_ids?: string[];
          color?: string | null;
          icon?: string | null;
          source_types?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          description?: string | null;
          filter_criteria?: Json;
          static_member_ids?: string[];
          color?: string | null;
          icon?: string | null;
          source_types?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
      };

      webhooks: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          description: string | null;
          url: string;
          secret: string;
          // First 8 chars of secret — replicated to Zero clients while
          // `secret` itself stays server-only. Added in migration 00048.
          secret_prefix: string;
          events: WebhookEventType[];
          source_filter: Json | null;
          custom_headers: Json;
          enabled: boolean;
          total_deliveries: number;
          successful_deliveries: number;
          failed_deliveries: number;
          last_triggered_at: string | null;
          last_success_at: string | null;
          last_failure_at: string | null;
          last_error: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          description?: string | null;
          url: string;
          secret: string;
          secret_prefix: string;
          events: WebhookEventType[];
          source_filter?: Json | null;
          custom_headers?: Json;
          enabled?: boolean;
          total_deliveries?: number;
          successful_deliveries?: number;
          failed_deliveries?: number;
          last_triggered_at?: string | null;
          last_success_at?: string | null;
          last_failure_at?: string | null;
          last_error?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          description?: string | null;
          url?: string;
          secret?: string;
          secret_prefix?: string;
          events?: WebhookEventType[];
          source_filter?: Json | null;
          custom_headers?: Json;
          enabled?: boolean;
          total_deliveries?: number;
          successful_deliveries?: number;
          failed_deliveries?: number;
          last_triggered_at?: string | null;
          last_success_at?: string | null;
          last_failure_at?: string | null;
          last_error?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      system_events: {
        Row: {
          id: string;
          org_id: string;
          event_type: string;
          category: string;
          title: string;
          description: string | null;
          severity: string;
          source_id: string | null;
          source_name: string | null;
          source_slug: string | null;
          entity_id: string | null;
          entity_type: string | null;
          actor_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          event_type: string;
          category: string;
          title: string;
          description?: string | null;
          severity?: string;
          source_id?: string | null;
          source_name?: string | null;
          source_slug?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          actor_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          event_type?: string;
          category?: string;
          title?: string;
          description?: string | null;
          severity?: string;
          source_id?: string | null;
          source_name?: string | null;
          source_slug?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          actor_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
      };

      webhook_deliveries: {
        Row: {
          id: string;
          org_id: string;
          webhook_id: string;
          event_type: WebhookEventType;
          event_id: string;
          payload: Json;
          status: WebhookDeliveryStatus;
          attempt_count: number;
          max_attempts: number;
          response_status: number | null;
          response_body: string | null;
          response_time_ms: number | null;
          error: string | null;
          scheduled_at: string;
          next_retry_at: string | null;
          delivered_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          webhook_id: string;
          event_type: WebhookEventType;
          event_id: string;
          payload: Json;
          status?: WebhookDeliveryStatus;
          attempt_count?: number;
          max_attempts?: number;
          response_status?: number | null;
          response_body?: string | null;
          response_time_ms?: number | null;
          error?: string | null;
          scheduled_at?: string;
          next_retry_at?: string | null;
          delivered_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          webhook_id?: string;
          event_type?: WebhookEventType;
          event_id?: string;
          payload?: Json;
          status?: WebhookDeliveryStatus;
          attempt_count?: number;
          max_attempts?: number;
          response_status?: number | null;
          response_body?: string | null;
          response_time_ms?: number | null;
          error?: string | null;
          scheduled_at?: string;
          next_retry_at?: string | null;
          delivered_at?: string | null;
          created_at?: string;
        };
      };
      notification_deliveries: {
        Row: {
          id: string;
          org_id: string;
          channel: NotificationChannel;
          integration_id: string;
          event_type: WebhookEventType;
          payload: Json;
          status: WebhookDeliveryStatus;
          attempt_count: number;
          max_attempts: number;
          response_status: number | null;
          response_body: string | null;
          response_time_ms: number | null;
          error: string | null;
          scheduled_at: string;
          next_retry_at: string | null;
          delivered_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          channel: NotificationChannel;
          integration_id: string;
          event_type: WebhookEventType;
          payload: Json;
          status?: WebhookDeliveryStatus;
          attempt_count?: number;
          max_attempts?: number;
          response_status?: number | null;
          response_body?: string | null;
          response_time_ms?: number | null;
          error?: string | null;
          scheduled_at?: string;
          next_retry_at?: string | null;
          delivered_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          channel?: NotificationChannel;
          integration_id?: string;
          event_type?: WebhookEventType;
          payload?: Json;
          status?: WebhookDeliveryStatus;
          attempt_count?: number;
          max_attempts?: number;
          response_status?: number | null;
          response_body?: string | null;
          response_time_ms?: number | null;
          error?: string | null;
          scheduled_at?: string;
          next_retry_at?: string | null;
          delivered_at?: string | null;
          created_at?: string;
        };
      };
      satellites: {
        Row: {
          id: string;
          org_id: string;
          norad_id: number;
          name: string;
          official_name: string | null;
          color: string;
          group_name: string | null;
          tle_line1: string | null;
          tle_line2: string | null;
          tle_epoch: string | null;
          tle_fetched_at: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          norad_id: number;
          name: string;
          official_name?: string | null;
          color?: string;
          group_name?: string | null;
          tle_line1?: string | null;
          tle_line2?: string | null;
          tle_epoch?: string | null;
          tle_fetched_at?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          norad_id?: number;
          name?: string;
          official_name?: string | null;
          color?: string;
          group_name?: string | null;
          tle_line1?: string | null;
          tle_line2?: string | null;
          tle_epoch?: string | null;
          tle_fetched_at?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
      };
      source_associations: {
        Row: {
          id: string;
          org_id: string;
          entity_type: string;
          entity_id: string;
          connection_id: string;
          table_name: string;
          table_schema: string | null;
          filter_column: string | null;
          filter_value: string | null;
          label: string | null;
          query_template: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          entity_type: string;
          entity_id: string;
          connection_id: string;
          table_name: string;
          table_schema?: string | null;
          filter_column?: string | null;
          filter_value?: string | null;
          label?: string | null;
          query_template?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          entity_type?: string;
          entity_id?: string;
          connection_id?: string;
          table_name?: string;
          table_schema?: string | null;
          filter_column?: string | null;
          filter_value?: string | null;
          label?: string | null;
          query_template?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Enums: {
      data_source_type: DataSourceType;
      data_source_status: DataSourceStatus;
      source_type: SourceType;
      source_status: SourceStatus;
      connection_type: ConnectionType;
      source_context_type: SourceContextType;
      limit_severity: LimitSeverity;
      share_link_access: ShareLinkAccess;
      share_link_status: ShareLinkStatus;
      feedback_type: FeedbackType;
      alert_trigger_type: AlertTriggerType;
      alert_status: AlertStatus;
      alert_event_type: AlertEventType;
      alert_rule_type: AlertRuleType;
      alert_rule_operator: AlertRuleOperator;
      webhook_event_type: WebhookEventType;
      webhook_delivery_status: WebhookDeliveryStatus;
      system_event_type: SystemEventType;
      system_event_category: SystemEventCategory;
      system_event_severity: SystemEventSeverity;
    };
  };
}

// =============================================================================
// HELPER TYPES (extracted from Database interface)
// =============================================================================

export type DataSource = Database["public"]["Tables"]["data_sources"]["Row"];
export type NewDataSource =
  Database["public"]["Tables"]["data_sources"]["Insert"];

export type Annotation = Database["public"]["Tables"]["annotations"]["Row"];
export type NewAnnotation =
  Database["public"]["Tables"]["annotations"]["Insert"];

export type ApiKey = Database["public"]["Tables"]["api_keys"]["Row"];
export type NewApiKey = Database["public"]["Tables"]["api_keys"]["Insert"];

export type Dashboard = Database["public"]["Tables"]["dashboards"]["Row"];
export type NewDashboard = Database["public"]["Tables"]["dashboards"]["Insert"];

export type DashboardIconAsset =
  Database["public"]["Tables"]["dashboard_icon_assets"]["Row"];
export type NewDashboardIconAsset =
  Database["public"]["Tables"]["dashboard_icon_assets"]["Insert"];

export type UserSettingsRecord =
  Database["public"]["Tables"]["user_settings"]["Row"];
export type NewUserSettingsRecord =
  Database["public"]["Tables"]["user_settings"]["Insert"];

export type UserNotificationState =
  Database["public"]["Tables"]["user_notification_state"]["Row"];
export type NewUserNotificationState =
  Database["public"]["Tables"]["user_notification_state"]["Insert"];

export type PlexusTable = Database["public"]["Tables"]["plexus_tables"]["Row"];
export type NewPlexusTable =
  Database["public"]["Tables"]["plexus_tables"]["Insert"];

export type PlexusTableRow =
  Database["public"]["Tables"]["plexus_table_rows"]["Row"];
export type NewPlexusTableRow =
  Database["public"]["Tables"]["plexus_table_rows"]["Insert"];

export type Source = Database["public"]["Tables"]["sources"]["Row"];
export type NewSource = Database["public"]["Tables"]["sources"]["Insert"];
export type UpdateSource = Database["public"]["Tables"]["sources"]["Update"];

/**
 * A database connection linked to a device (stored in source.metadata.linked_connections).
 *
 * The link is intentionally simple: which connection, and what filter value
 * identifies this device in the database. Schema intelligence runs at
 * dashboard generation time, not at link time.
 */
/**
 * Association between a device and an external data connection.
 * Used for telemetry data.
 */
export interface LinkedConnection {
  connection_id: string;
  label?: string;
  /** Filter value (the identifier of THIS device in the connection's tables). */
  filter_value?: string;

  /** @deprecated Schema intelligence now runs at generation time */
  column_mappings?: Record<string, string>;
  /** @deprecated Schema intelligence now runs at generation time */
  table_filters?: unknown;
  /** @deprecated No longer used */
  table_name?: string;
  /** @deprecated No longer used */
  filter_column?: string;
  /** @deprecated Schema intelligence now runs at generation time */
  manual_overrides?: Record<string, ManualOverride>;
}

/** A user's manual column mapping for a specific ontology requirement */
export interface ManualOverride {
  table: string;
  column: string;
  /** Second column for column_pair requirements (e.g., TLE line2, longitude) */
  column2?: string;
}

export type SourceContext =
  Database["public"]["Tables"]["source_context"]["Row"];
export type NewSourceContext =
  Database["public"]["Tables"]["source_context"]["Insert"];
export type UpdateSourceContext =
  Database["public"]["Tables"]["source_context"]["Update"];

export type SourceLimitRecord =
  Database["public"]["Tables"]["source_limits"]["Row"];
export type NewSourceLimitRecord =
  Database["public"]["Tables"]["source_limits"]["Insert"];
export type UpdateSourceLimitRecord =
  Database["public"]["Tables"]["source_limits"]["Update"];

// Device schema registry (added in migration 00012)
export interface DeviceSchemaRecord {
  id: string;
  org_id: string;
  source_id: string;
  metric: string;
  value_type: "number" | "string" | "boolean" | "object" | "array";
  sample_count: number;
  min_value: number | null;
  max_value: number | null;
  last_value_at: string | null;
  first_seen_at: string;
  created_at: string;
  updated_at: string;
}

// Column metadata field enums (added in migration 00049)
export type ColumnSemanticType =
  | "identifier"
  | "category"
  | "measurement"
  | "status"
  | "location"
  | "timestamp"
  | "text"
  | "boolean";
export type ColumnMlRole = "feature" | "target" | "identifier" | "ignore";
export type ColumnAggregation =
  | "avg"
  | "sum"
  | "min"
  | "max"
  | "last"
  | "none";
export type ColumnSensitivity = "none" | "pii" | "sensitive";

// Per-column AI suggestion payload (also persisted to ai_suggested)
export interface ColumnSuggestion {
  column_key: string;
  label?: string;
  unit?: string;
  semantic_type?: ColumnSemanticType;
  ml_role?: ColumnMlRole;
  aggregation?: ColumnAggregation;
  description?: string;
  confidence: number;
}

// User-authored column annotations (added in migration 00049).
// column_key is the metric name (devices) or "table.column" (connections).
export interface ColumnMetadataRecord {
  id: string;
  org_id: string;
  source_id: string; // source slug
  column_key: string;
  label: string | null;
  description: string | null;
  unit: string | null;
  semantic_type: ColumnSemanticType | null;
  ml_role: ColumnMlRole | null;
  aggregation: ColumnAggregation | null;
  sensitivity: ColumnSensitivity;
  expected_min: number | null;
  expected_max: number | null;
  categories: string[];
  tags: string[];
  extra: Record<string, unknown>;
  ai_suggested: ColumnSuggestion | null;
  source_origin: "user" | "ai" | "ai_accepted";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Device classification result (stored in source metadata)
export interface DeviceClassification {
  type: string;
  confidence: number;
  reasoning: string;
  classified_at: string;
  model: string;
  metric_count: number;
}

export interface AlertVisualization {
  panel_type: string;
  panel_config: Record<string, unknown>;
}

/** One ANDed row predicate on an event monitor's poll query. */
export interface EventMonitorFilter {
  column: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
  value: string;
}

export type EventMonitorDelivery = "digest" | "per_row";

export interface EventMonitorRecord {
  id: string;
  org_id: string;
  source_id: string;
  metric: string;
  severity: LimitSeverity;
  message: string | null;
  enabled: boolean;
  silenced_until: string | null;
  visualization: AlertVisualization | null;
  notification_target_ids: string[] | null;
  table_name: string | null;
  time_column: string | null;
  poll_watermark: string | null;
  last_polled_at: string | null;
  context_columns: string[] | null;
  filters: EventMonitorFilter[] | null;
  delivery: EventMonitorDelivery | null;
  last_status: MonitorHealthStatus | null;
  last_error: string | null;
  last_evaluated_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Outcome of the most recent poll attempt on a monitor. */
export type MonitorHealthStatus = "ok" | "skipped" | "error";

export type DashboardShareLink =
  Database["public"]["Tables"]["dashboard_share_links"]["Row"];
export type NewDashboardShareLink =
  Database["public"]["Tables"]["dashboard_share_links"]["Insert"];
export type UpdateDashboardShareLink =
  Database["public"]["Tables"]["dashboard_share_links"]["Update"];

export type DashboardView =
  Database["public"]["Tables"]["dashboard_views"]["Row"];
export type NewDashboardView =
  Database["public"]["Tables"]["dashboard_views"]["Insert"];
export type UpdateDashboardView =
  Database["public"]["Tables"]["dashboard_views"]["Update"];

export type DashboardPermission =
  Database["public"]["Tables"]["dashboard_permissions"]["Row"];
export type NewDashboardPermission =
  Database["public"]["Tables"]["dashboard_permissions"]["Insert"];
export type UpdateDashboardPermission =
  Database["public"]["Tables"]["dashboard_permissions"]["Update"];

export type Feedback = Database["public"]["Tables"]["feedback"]["Row"];
export type NewFeedback = Database["public"]["Tables"]["feedback"]["Insert"];
export type UpdateFeedback = Database["public"]["Tables"]["feedback"]["Update"];

export type Alert = Database["public"]["Tables"]["alerts"]["Row"];
export type NewAlert = Database["public"]["Tables"]["alerts"]["Insert"];
export type UpdateAlert = Database["public"]["Tables"]["alerts"]["Update"];

export type AlertEvent = Database["public"]["Tables"]["alert_events"]["Row"];
export type NewAlertEvent =
  Database["public"]["Tables"]["alert_events"]["Insert"];

export type AlertRule = Database["public"]["Tables"]["alert_rules"]["Row"];
export type NewAlertRule =
  Database["public"]["Tables"]["alert_rules"]["Insert"];
export type UpdateAlertRule =
  Database["public"]["Tables"]["alert_rules"]["Update"];

export type TerminalConversation =
  Database["public"]["Tables"]["terminal_conversations"]["Row"];
export type NewTerminalConversation =
  Database["public"]["Tables"]["terminal_conversations"]["Insert"];

/** Standalone Satellite interface — same shape as the former satellites table Row */
export interface Satellite {
  id: string;
  org_id: string;
  norad_id: number;
  name: string;
  official_name: string | null;
  color: string;
  group_name: string | null;
  tle_line1: string | null;
  tle_line2: string | null;
  tle_epoch: string | null;
  tle_fetched_at: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

/** Metadata stored in sources.metadata for device_type="satellite" */
export interface SatelliteSourceMetadata {
  norad_id: number;
  official_name: string | null;
  color: string;
  group_name: string | null;
  tle_line1: string | null;
  tle_line2: string | null;
  tle_epoch: string | null;
  tle_fetched_at: string | null;
  /** Tag showing which source last provided the TLE. */
  tle_source?: "celestrak" | "connection";
}

export type SourceAssociation =
  Database["public"]["Tables"]["source_associations"]["Row"];
export type NewSourceAssociation =
  Database["public"]["Tables"]["source_associations"]["Insert"];

export type SourceLimit = {
  min?: number;
  max?: number;
  severity: LimitSeverity;
  message?: string;
};

// Type guards for sources
export function isDeviceSource(source: Source): boolean {
  return source.source_type === "device";
}

export function isConnectionSource(source: Source): boolean {
  return source.source_type === "connection";
}

// =============================================================================
// USAGE TYPES (for billing)
// =============================================================================

export interface Usage {
  id: string;
  org_id: string;
  period_start: string;
  data_points_ingested: number;
  bytes_ingested: number;
  devices_active: number;
  runs_created: number;
  created_at: string;
  updated_at: string;
}

export interface UsageSummary {
  currentPeriod: {
    dataPoints: number;
    bytesIngested: number;
    devicesActive: number;
    runsCreated: number;
  };

  limits: {
    dataPointsPerMonth: number;
    storageBytes: number;
    sourcesMax: number;
  };
  plan?: {
    id: string;
    name: string;
  };
}

// =============================================================================
// PLEXUS TABLE META (camelCase version for internal use)
// =============================================================================

export interface PlexusTableMeta {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  columns: PlexusColumn[];
  rowCount: number;
  sourceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTableInput {
  name: string;
  description?: string;
  columns: PlexusColumn[];
}

export interface UpdateTableInput {
  name?: string;
  description?: string;
  columns?: PlexusColumn[];
}

export interface QueryParams {
  columns?: string[];
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: "asc" | "desc";
  where?: Record<string, unknown>;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  total: number;
}

export interface PlexusRow {
  id: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// STORAGE INTERFACE
// =============================================================================

export interface PlexusStorage {
  insertRows(
    table: PlexusTableMeta,
    rows: Record<string, unknown>[],
  ): Promise<string[]>;

  queryRows(table: PlexusTableMeta, params: QueryParams): Promise<QueryResult>;

  updateRow(
    table: PlexusTableMeta,
    rowId: string,
    data: Record<string, unknown>,
  ): Promise<void>;

  deleteRow(table: PlexusTableMeta, rowId: string): Promise<void>;

  createTableStorage(table: PlexusTableMeta): Promise<void>;

  dropTableStorage(table: PlexusTableMeta): Promise<void>;

  addColumn(table: PlexusTableMeta, column: PlexusColumn): Promise<void>;
}

// =============================================================================
// DASHBOARD SHARING ANALYTICS TYPES
// =============================================================================

export interface DashboardViewAnalytics {
  totalViews: number;
  uniqueViewers: number;
  averageDuration: number;
  // Trends compared to previous period (percentage change)
  trends: {
    views: number | null; // e.g., 25 means +25%, -10 means -10%
    viewers: number | null;
    duration: number | null;
  };
  viewsByDay: Array<{
    date: string;
    views: number;
  }>;
  viewsByCountry: Array<{
    country: string;
    views: number;
  }>;
  viewsByReferrer: Array<{
    source: string; // hostname or "Direct"
    views: number;
  }>;
  shareLinkStats: Array<{
    id: string;
    name: string | null;
    views: number;
    uniqueViewers: number;
    lastViewedAt: string | null;
  }>;
  recentViews: Array<{
    id: string;
    startedAt: string;
    duration: number | null;
    country: string | null;
    city: string | null;
    referrer: string | null;
    shareLinkName: string | null;
  }>;
}

export interface ShareLinkWithStats extends DashboardShareLink {
  viewCount: number;
  lastViewedAt: string | null;
}

// =============================================================================
// ORG MEMBER TYPES (app-owned roles + mirrored identity in org_members)
// =============================================================================

export type OrgMemberRow = Database["public"]["Tables"]["org_members"]["Row"];
export type NewOrgMember =
  Database["public"]["Tables"]["org_members"]["Insert"];

// =============================================================================
// SOURCE GROUP TYPES (renamed from device groups)
// =============================================================================

export type SourcePermission =
  Database["public"]["Tables"]["source_permissions"]["Row"];
export type NewSourcePermission =
  Database["public"]["Tables"]["source_permissions"]["Insert"];

export type SourceGroup = Database["public"]["Tables"]["source_groups"]["Row"];
export type NewSourceGroup =
  Database["public"]["Tables"]["source_groups"]["Insert"];
export type UpdateSourceGroup =
  Database["public"]["Tables"]["source_groups"]["Update"];

/**
 * Filter criteria for dynamic source group membership
 * Sources matching ANY of the criteria arrays are included (OR logic)
 * Within each criteria array, ALL conditions must match (AND logic)
 */
export interface SourceGroupFilterCriteria {
  // Match by device type
  deviceTypes?: string[];
  // Match by connection type
  connectionTypes?: string[];
  // Match by source type (device, connection)
  sourceTypes?: SourceType[];
  // Match by tags (source must have ALL specified tags)
  tags?: string[];
  // Match by status
  statuses?: SourceStatus[];
  // Match by health score range
  healthScoreMin?: number;
  healthScoreMax?: number;
  // Match by name pattern (case-insensitive contains)
  namePattern?: string;
  // Match by slug pattern (case-insensitive contains)
  slugPattern?: string;
}

/**
 * Source group with computed members
 */
export interface SourceGroupWithMembers extends SourceGroup {
  members: Source[];
  memberCount: number;
}

// =============================================================================
// WEBHOOK TYPES
// =============================================================================

export type Webhook = Database["public"]["Tables"]["webhooks"]["Row"];
export type NewWebhook = Database["public"]["Tables"]["webhooks"]["Insert"];
export type UpdateWebhook = Database["public"]["Tables"]["webhooks"]["Update"];

export type WebhookDelivery =
  Database["public"]["Tables"]["webhook_deliveries"]["Row"];
export type NewWebhookDelivery =
  Database["public"]["Tables"]["webhook_deliveries"]["Insert"];
export type UpdateWebhookDelivery =
  Database["public"]["Tables"]["webhook_deliveries"]["Update"];

export type NotificationDelivery =
  Database["public"]["Tables"]["notification_deliveries"]["Row"];
export type NewNotificationDelivery =
  Database["public"]["Tables"]["notification_deliveries"]["Insert"];

export type SystemEvent = Database["public"]["Tables"]["system_events"]["Row"];
export type NewSystemEvent =
  Database["public"]["Tables"]["system_events"]["Insert"];

/**
 * Source filter for webhooks
 * Only trigger webhooks for events from matching sources
 */
// =============================================================================
export interface WebhookSourceFilter {
  sourceIds?: string[];
  deviceTypes?: string[];
  tags?: string[];
  groupIds?: string[];
}

/**
 * Webhook payload structure sent to endpoints
 */
export interface WebhookPayload {
  event: WebhookEventType;
  eventId: string;
  timestamp: string;
  orgId: string;
  data: {
    alertId?: string;
    sourceId?: string;
    sourceName?: string;
    sourceSlug?: string;
    metric?: string;
    value?: number;
    threshold?: number;
    severity?: LimitSeverity;
    message?: string;
    [key: string]: unknown;
  };
}

// =============================================================================
// SOURCE HEALTH TYPES
// =============================================================================

/**
 * Enhanced source health with group information
 */
export interface SourceHealthSummary {
  total: number;
  online: number;
  offline: number;
  unknown: number;
  byType: Record<string, number>;
  byHealthScore: {
    healthy: number; // 80-100
    degraded: number; // 50-79
    unhealthy: number; // 0-49
    unknown: number; // null
  };
  groups: Array<{
    id: string;
    name: string;
    color?: string;
    memberCount: number;
    onlineCount: number;
    averageHealthScore: number | null;
  }>;
  recentAlerts: number;
}

// =============================================================================
// ALERT-SERVICE WIRE TYPES
// =============================================================================

/** Wire format for alert rules sent to/from the alert-service. */
export interface AlertRuleWire {
  id: string;
  org_id: string;
  source_id: string; // slug, not UUID
  type: AlertRuleType;
  metric?: string;
  conditions?: {
    min?: number;
    max?: number;
    z_score?: number;
    min_samples?: number;
  };
  operator?: AlertRuleOperator;
  rules?: SubRuleWire[]; // wire field name is "rules", DB column is "sub_rules"
  hysteresis_seconds?: number;
  cooldown_seconds?: number;
  severity: string;
}

export interface SubRuleWire {
  type: "threshold" | "outlier";
  metric: string;
  conditions: {
    min?: number;
    max?: number;
    z_score?: number;
    min_samples?: number;
  };
}

/** Transition delivered by alert-service via POST /api/internal/alerts/transitions. */
export interface DistSnapshot {
  mean: number;
  stddev: number;
  count: number;
}

export interface AlertStats {
  opened_at: number;
  closed_at: number;
  duration_seconds: number;
  trigger_value: number;
  peak_value: number;
  peak_z_score?: number;
  recovery_value?: number;
  retrigger_count: number;
  data_point_count: number;
  open_dist: DistSnapshot;
  close_dist: DistSnapshot;
  dist_drift: number;
}

/** Returned by GET /api/alerts/live-stats for an in-flight alert. */
export interface LiveStats {
  state: "breaching" | "recovering";
  opened_at: number;
  trigger_value: number;
  peak_value: number;
  peak_z_score?: number;
  retrigger_count: number;
  data_point_count: number;
  current_dist: DistSnapshot;
  hysteresis_progress?: number; // 0.0–1.0, present only when recovering
}

export interface TransitionWire {
  rule_id: string;
  org_id: string;
  source_id: string; // slug, not UUID
  metric: string;
  state: "open" | "closed";
  value: number;
  threshold?: number;
  z_score?: number;
  severity: string;
  distribution?: DistSnapshot;
  timestamp: number; // unix seconds
  stats?: AlertStats; // closed transitions only, threshold/outlier rules
}

export interface DeviceEvent {
  source_id: string;
  timestamp: string;
  name: string;
  body: string;
  tags: Record<string, string>;
}
