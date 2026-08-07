import { relations } from "drizzle-orm/relations";
import { dashboards, dashboardPermissions, sources, sourceLimits, alerts, alertRules, users, authSessions, alertEvents, dashboardShareLinks, dashboardViews, apiKeys, deviceAuthRequests, sourceGroups, sourcePermissions, sourceAssociations, sourceContext, webhooks, webhookDeliveries, authAccounts } from "./schema";

export const dashboardPermissionsRelations = relations(dashboardPermissions, ({one}) => ({
	dashboard: one(dashboards, {
		fields: [dashboardPermissions.dashboard_id],
		references: [dashboards.id]
	}),
}));

export const dashboardsRelations = relations(dashboards, ({one, many}) => ({
	dashboardPermissions: many(dashboardPermissions),
	dashboardShareLinks: many(dashboardShareLinks),
	dashboard: one(dashboards, {
		fields: [dashboards.parent_id],
		references: [dashboards.id],
		relationName: "dashboards_parentId_dashboards_id"
	}),
	dashboards: many(dashboards, {
		relationName: "dashboards_parentId_dashboards_id"
	}),
	dashboardViews: many(dashboardViews),
}));

export const sourceLimitsRelations = relations(sourceLimits, ({one, many}) => ({
	source: one(sources, {
		fields: [sourceLimits.source_id],
		references: [sources.id]
	}),
	alerts: many(alerts),
}));

export const sourcesRelations = relations(sources, ({many}) => ({
	sourceLimits: many(sourceLimits),
	alerts: many(alerts),
	sourcePermissions: many(sourcePermissions),
	sourceAssociations: many(sourceAssociations),
	sourceContexts: many(sourceContext),
}));

export const alertsRelations = relations(alerts, ({one, many}) => ({
	sourceLimit: one(sourceLimits, {
		fields: [alerts.limit_id],
		references: [sourceLimits.id]
	}),
	alertRule: one(alertRules, {
		fields: [alerts.rule_id],
		references: [alertRules.id]
	}),
	source: one(sources, {
		fields: [alerts.source_id],
		references: [sources.id]
	}),
	alertEvents: many(alertEvents),
}));

export const alertRulesRelations = relations(alertRules, ({many}) => ({
	alerts: many(alerts),
}));

export const authSessionsRelations = relations(authSessions, ({one}) => ({
	user: one(users, {
		fields: [authSessions.user_id],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	authSessions: many(authSessions),
	authAccounts: many(authAccounts),
}));

export const alertEventsRelations = relations(alertEvents, ({one}) => ({
	alert: one(alerts, {
		fields: [alertEvents.alert_id],
		references: [alerts.id]
	}),
}));

export const dashboardShareLinksRelations = relations(dashboardShareLinks, ({one, many}) => ({
	dashboard: one(dashboards, {
		fields: [dashboardShareLinks.dashboard_id],
		references: [dashboards.id]
	}),
	dashboardViews: many(dashboardViews),
}));

export const dashboardViewsRelations = relations(dashboardViews, ({one}) => ({
	dashboard: one(dashboards, {
		fields: [dashboardViews.dashboard_id],
		references: [dashboards.id]
	}),
	dashboardShareLink: one(dashboardShareLinks, {
		fields: [dashboardViews.share_link_id],
		references: [dashboardShareLinks.id]
	}),
}));

export const deviceAuthRequestsRelations = relations(deviceAuthRequests, ({one}) => ({
	apiKey: one(apiKeys, {
		fields: [deviceAuthRequests.api_key_id],
		references: [apiKeys.id]
	}),
}));

export const apiKeysRelations = relations(apiKeys, ({many}) => ({
	deviceAuthRequests: many(deviceAuthRequests),
}));

export const sourcePermissionsRelations = relations(sourcePermissions, ({one}) => ({
	sourceGroup: one(sourceGroups, {
		fields: [sourcePermissions.source_group_id],
		references: [sourceGroups.id]
	}),
	source: one(sources, {
		fields: [sourcePermissions.source_id],
		references: [sources.id]
	}),
}));

export const sourceGroupsRelations = relations(sourceGroups, ({many}) => ({
	sourcePermissions: many(sourcePermissions),
}));

export const sourceAssociationsRelations = relations(sourceAssociations, ({one}) => ({
	source: one(sources, {
		fields: [sourceAssociations.connection_id],
		references: [sources.id]
	}),
}));

export const sourceContextRelations = relations(sourceContext, ({one}) => ({
	source: one(sources, {
		fields: [sourceContext.source_id],
		references: [sources.id]
	}),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({one}) => ({
	webhook: one(webhooks, {
		fields: [webhookDeliveries.webhook_id],
		references: [webhooks.id]
	}),
}));

export const webhooksRelations = relations(webhooks, ({many}) => ({
	webhookDeliveries: many(webhookDeliveries),
}));

export const authAccountsRelations = relations(authAccounts, ({one}) => ({
	user: one(users, {
		fields: [authAccounts.user_id],
		references: [users.id]
	}),
}));