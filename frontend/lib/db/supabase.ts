/**
 * Database query barrel.
 *
 * Re-exports all query modules for backward compatibility (the module name is
 * historical — the implementations now run on Drizzle, not Supabase).
 * Actual implementations live in lib/db/queries/*.
 */

// Factory
export { createOrgQueries } from "./queries/shared";

// Dashboard queries
export {
  dashboardQueries,
  dashboardShareLinkQueries,
  dashboardViewQueries,
  dashboardPermissionQueries,
} from "./queries/dashboards";

// Source queries
export {
  sourceQueries,
  sourceContextQueries,
  sourceLimitQueries,
  sourceGroupQueries,
  sourcePermissionQueries,
} from "./queries/sources";

// Alert queries
export { alertQueries, alertEventQueries } from "./queries/alerts";

// Integration queries
export {
  webhookQueries,
  webhookDeliveryQueries,
  notificationDeliveryQueries,
  slackIntegrationQueries,
  slackOAuthStateQueries,
  emailIntegrationQueries,
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

