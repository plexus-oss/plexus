/**
 * Database Module
 *
 * Single entry point for all database operations.
 * Import from "@/lib/db" for all database needs.
 * IMPORTANT: For admin (no-RLS) operations, import from "@/lib/db/server" —
 * those run on the Drizzle pool and must only be used in API routes.
 */

// Types
export * from "./types";

// Factory
export {
  createOrgQueries,
  runWithServiceRole,
} from "./queries/shared";

// Dashboard queries
export {
  dashboardQueries,
  dashboardShareLinkQueries,
  dashboardViewQueries,
  dashboardPermissionQueries,
} from "./queries/dashboards";
export { dashboardIconAssetQueries } from "./queries/icon-assets";

// Source queries
export {
  sourceQueries,
  sourceContextQueries,
  sourceLimitQueries,
  sourceGroupQueries,
  sourcePermissionQueries,
  sourceAssociationQueries,
  eventMonitorQueries,
  deviceSchemaQueries,
  columnMetadataQueries,
  getColumnMetadataMap,
} from "./queries/sources";

// Alert queries
export { alertQueries, alertEventQueries } from "./queries/alerts";
export { alertRuleQueries } from "./queries/alert-rules";

// Terminal conversation history
export { terminalConversationQueries } from "./queries/terminal-conversations";

// Integration queries
export {
  webhookQueries,
  webhookDeliveryQueries,
  notificationDeliveryQueries,
  slackIntegrationQueries,
  slackOAuthStateQueries,
} from "./queries/integrations";

// Misc queries
export {
  apiKeyQueries,
  annotationQueries,
  userSettingsQueries,
  userNotificationStateQueries,
  usageQueries,
  feedbackQueries,
  systemEventQueries,
} from "./queries/misc";

