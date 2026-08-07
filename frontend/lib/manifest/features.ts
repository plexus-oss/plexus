import type { FeatureEntry } from "./types";

export const FEATURE_MANIFEST = {
  // ===========================================================================
  // DATA
  // ===========================================================================

  dashboards: {
    label: "Dashboards",
    description: "Real-time dashboards with panels and visualizations.",
    category: "data",
    limits: { limitKey: "maxDashboards" },
    routes: ["/dashboards"],
    actions: [
      {
        id: "action-new-dashboard",
        label: "Create New Dashboard",
        icon: "LayoutDashboard",
        surfaces: ["toolbar"],
        requiredRole: "org:editor",
      },
      {
        id: "action-rename-dashboard",
        label: "Rename",
        icon: "Pencil",
        surfaces: ["context_menu"],
        entityTypes: ["dashboard"],
        requiredRole: "org:editor",
        // Server gates rename via per-dashboard edit access, not this role
        // threshold — hidden from the matrix so the row can't lie.
        matrix: false,
      },
      {
        id: "action-duplicate-dashboard",
        label: "Duplicate",
        icon: "Copy",
        surfaces: ["context_menu"],
        entityTypes: ["dashboard"],
      },
      {
        id: "action-share-dashboard",
        label: "Share",
        icon: "Share2",
        surfaces: ["context_menu"],
        entityTypes: ["dashboard"],
        // Server gates sharing via per-dashboard manage rights (creator/admin
        // /edit-grant), not this threshold — hidden from the matrix.
        matrix: false,
      },
      {
        id: "action-open-new-tab-dashboard",
        label: "Open in new tab",
        icon: "ExternalLink",
        surfaces: ["context_menu"],
        entityTypes: ["dashboard"],
        // Pure client navigation — nothing to permission.
        matrix: false,
      },
      {
        id: "action-delete-dashboard",
        label: "Delete",
        icon: "Trash2",
        surfaces: ["context_menu"],
        entityTypes: ["dashboard"],
        requiredRole: "org:editor",
        isDestructive: true,
      },
    ],
  },

  devices: {
    label: "Devices",
    description: "Connected hardware devices and agents.",
    category: "data",
    limits: { limitKey: "maxSources" },
    routes: ["/devices"],
    actions: [
      {
        id: "action-pair-device",
        label: "Pair Source",
        icon: "Wifi",
        surfaces: ["toolbar"],
        requiredRole: "org:editor",
      },
      {
        id: "action-view-device",
        label: "View Details",
        icon: "Eye",
        surfaces: ["context_menu"],
        entityTypes: ["device"],
        // Pure client navigation — nothing to permission.
        matrix: false,
      },
      {
        id: "action-delete-device",
        label: "Delete",
        icon: "Trash2",
        surfaces: ["context_menu"],
        entityTypes: ["device"],
        requiredRole: "org:editor",
        isDestructive: true,
        supportsBulk: true,
      },
      // Fleets (source groups) have a gated CRUD API but NO product UI —
      // nothing calls createGroup/updateGroup/deleteGroup. Kept here so the
      // API enforcement stays fail-closed, hidden from the matrix so it
      // doesn't advertise an unreachable feature. Un-hide when fleet UI ships.
      {
        id: "action-create-fleet",
        label: "Create Fleet",
        icon: "Boxes",
        requiredRole: "org:editor",
        matrix: false,
      },
      {
        id: "action-edit-fleet",
        label: "Edit Fleet",
        icon: "Boxes",
        requiredRole: "org:editor",
        matrix: false,
      },
      {
        id: "action-delete-fleet",
        label: "Delete Fleet",
        icon: "Trash2",
        requiredRole: "org:editor",
        isDestructive: true,
        matrix: false,
      },
    ],
  },

  connections: {
    label: "Connections",
    description: "External database connections.",
    category: "data",
    routes: ["/connections"],
    actions: [
      {
        id: "action-connect-data",
        label: "Connect Data Source",
        icon: "Database",
        surfaces: ["toolbar"],
        requiredRole: "org:editor",
      },
      {
        id: "action-delete-connection",
        label: "Remove",
        icon: "Trash2",
        surfaces: ["context_menu"],
        entityTypes: ["connection"],
        requiredRole: "org:editor",
        isDestructive: true,
      },
    ],
  },

  data: {
    label: "Data",
    description: "Data explorer for querying telemetry.",
    category: "data",
    routes: ["/data"],
    actions: [
      // Annotation actions surface only in the Role Matrix (no entityTypes →
      // never rendered in menus); they exist to gate the API.
      {
        id: "action-create-annotation",
        label: "Create Annotation",
        icon: "Tag",
        surfaces: ["context_menu"],
        requiredRole: "org:editor",
      },
      {
        id: "action-edit-annotation",
        label: "Edit Annotation",
        icon: "Tag",
        surfaces: ["context_menu"],
        requiredRole: "org:editor",
      },
      {
        id: "action-delete-annotation",
        label: "Delete Annotation",
        icon: "Trash2",
        surfaces: ["context_menu"],
        requiredRole: "org:editor",
        isDestructive: true,
      },
    ],
  },

  runs: {
    label: "Runs",
    description: "Hardware test runs — named time windows with recall and compare.",
    category: "data",
    routes: ["/runs"],
    actions: [
      {
        id: "action-create-run",
        label: "Create Run",
        icon: "Play",
        surfaces: ["toolbar"],
        requiredRole: "org:editor",
      },
      {
        id: "action-edit-run",
        label: "Edit Run",
        icon: "Pencil",
        surfaces: ["context_menu"],
        requiredRole: "org:editor",
      },
      {
        id: "action-delete-run",
        label: "Delete Run",
        icon: "Trash2",
        surfaces: ["context_menu"],
        requiredRole: "org:editor",
        isDestructive: true,
      },
    ],
  },

  data_persistence: {
    label: "Data Persistence",
    description: "Record and store telemetry data for historical analysis.",
    category: "data",
    actions: [
      // Matrix-only (no menus): gates POST/DELETE /api/recordings — starting
      // a camera recording kicks off a billable recorder job.
      {
        id: "action-start-recording",
        label: "Start / Stop Recordings",
        icon: "Video",
        requiredRole: "org:editor",
      },
    ],
  },

  // ===========================================================================
  // OBSERVE
  // ===========================================================================

  alerts: {
    label: "Alerts",
    description: "Alert rules and incident management.",
    category: "observe",
    routes: ["/alerts"],
    actions: [
      {
        id: "action-new-alert",
        label: "Create Alert Rule",
        icon: "AlertTriangle",
        surfaces: ["toolbar"],
        requiredRole: "org:editor",
      },
      {
        id: "action-acknowledge-alert",
        label: "Acknowledge",
        icon: "Check",
        surfaces: ["context_menu"],
        entityTypes: ["alert"],
        supportsBulk: true,
      },
      {
        id: "action-delete-alert",
        label: "Delete",
        icon: "Trash2",
        surfaces: ["context_menu"],
        entityTypes: ["alert"],
        requiredRole: "org:editor",
        isDestructive: true,
        supportsBulk: true,
      },
    ],
  },

  events: {
    label: "Events",
    description: "System event log and audit trail.",
    category: "observe",
    routes: ["/events"],
    actions: [],
  },


  // ===========================================================================
  // CONFIGURE
  // ===========================================================================

  settings: {
    label: "Settings",
    description: "Organization settings and preferences.",
    category: "configure",
    routes: ["/settings", "/api"],
    actions: [
      {
        id: "action-remove-member",
        label: "Remove Member",
        icon: "UserMinus",
        surfaces: ["context_menu"],
        entityTypes: ["member"],
        requiredRole: "org:admin",
        isDestructive: true,
      },
    ],
  },

  integrations: {
    label: "Integrations",
    description: "Slack, email, and webhook notification channels.",
    category: "configure",
    routes: ["/alerts/integrations"],
    actions: [
      // Slack + email channels: create, edit, delete, send test messages.
      {
        id: "action-manage-integrations",
        label: "Manage Slack / Email Channels",
        icon: "Bell",
        requiredRole: "org:editor",
      },
      {
        id: "action-create-webhook",
        label: "Create Webhook",
        icon: "Webhook",
        requiredRole: "org:admin",
      },
      {
        id: "action-edit-webhook",
        label: "Edit Webhook",
        icon: "Pencil",
        requiredRole: "org:admin",
      },
      {
        id: "action-test-webhook",
        label: "Test Webhook",
        icon: "Zap",
        requiredRole: "org:admin",
      },
      {
        id: "action-delete-webhook",
        label: "Delete Webhook",
        icon: "Trash2",
        requiredRole: "org:admin",
        isDestructive: true,
      },
    ],
  },
} as const satisfies Record<string, FeatureEntry>;

export type FeatureDomain = keyof typeof FEATURE_MANIFEST;
