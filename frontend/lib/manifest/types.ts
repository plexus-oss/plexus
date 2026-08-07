import type { OrgRole } from "@/lib/api/rbac";

/** Names of usage counters surfaced in the manifest, for UI badges. */
export type ManifestLimitKey =
  | "maxSources"
  | "maxDashboards"
  | "maxApiKeys"
  | "maxDataPointsPerMonth"
  | "dataRetentionDays"
  | "seats";

// ---------------------------------------------------------------------------
// Entity types that support context menus and bulk operations
// ---------------------------------------------------------------------------

export type EntityType =
  | "dashboard"
  | "device"
  | "connection"
  | "alert"
  | "webhook"
  | "member";

// ---------------------------------------------------------------------------
// Type-safe action IDs — single source of truth
// ---------------------------------------------------------------------------

export const ACTION_IDS = [
  // Actions — toolbar
  "action-new-dashboard",
  "action-new-alert",
  "action-pair-device",
  "action-connect-data",
  // Actions — context menu: dashboard
  "action-rename-dashboard",
  "action-duplicate-dashboard",
  "action-share-dashboard",
  "action-open-new-tab-dashboard",
  "action-delete-dashboard",
  // Actions — context menu: device
  "action-view-device",
  "action-delete-device",
  // Actions — fleets (source groups)
  "action-create-fleet",
  "action-edit-fleet",
  "action-delete-fleet",
  // Actions — annotations
  "action-create-annotation",
  "action-edit-annotation",
  "action-delete-annotation",
  // Actions — context menu: connection
  "action-delete-connection",
  // Actions — runs
  "action-create-run",
  "action-edit-run",
  "action-delete-run",
  // Actions — recordings
  "action-start-recording",
  // Actions — context menu: alert
  "action-acknowledge-alert",
  "action-delete-alert",
  // Actions — integrations (Slack / email / webhooks)
  "action-manage-integrations",
  "action-create-webhook",
  "action-edit-webhook",
  "action-test-webhook",
  "action-delete-webhook",
  // Actions — context menu: member
  "action-remove-member",
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

// ---------------------------------------------------------------------------
// Manifest action — one definition powers context menu and toolbar
// ---------------------------------------------------------------------------

export type ActionSurface = "context_menu" | "toolbar";

export interface ManifestAction {
  id: ActionId;
  label: string;
  /** Lucide icon name (string for serialization — resolved at render time) */
  icon: string;
  /** Where this action should appear (optional for children that inherit parent context) */
  surfaces?: ActionSurface[];
  /** Which entity right-click menus show this action */
  entityTypes?: EntityType[];
  /** Minimum org role required */
  requiredRole?: OrgRole;
  /** Whether this action supports multi-select */
  supportsBulk?: boolean;
  /** Shows confirmation dialog before executing */
  isDestructive?: boolean;
  /**
   * Show this action in the Settings → Access permission matrix (default
   * true). Set false for navigation-only actions and for actions governed by
   * per-resource access rather than the role threshold — a matrix row the
   * server ignores is worse than no row.
   */
  matrix?: boolean;
}

// ---------------------------------------------------------------------------
// Feature entry — one per domain
// ---------------------------------------------------------------------------

export interface FeatureEntry {
  label: string;
  description: string;
  category: "data" | "observe" | "operate" | "configure";
  limits?: {
    limitKey?: ManifestLimitKey;
  };
  routes?: string[];
  actions: ManifestAction[];
}
