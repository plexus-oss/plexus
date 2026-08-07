import type { OrgRole } from "@/lib/api/rbac";
import type { ManifestAction, EntityType, FeatureEntry } from "./types";
import { FEATURE_MANIFEST } from "./features";
import { canFor, type CustomRoleDef } from "@/lib/access/resolver";

// Widen to FeatureEntry[] for iteration (as const satisfies preserves narrow literals)
const features = Object.values(FEATURE_MANIFEST) as FeatureEntry[];

// ---------------------------------------------------------------------------
// Access checks
// ---------------------------------------------------------------------------

/**
 * Check if an action is available given a role (custom-role aware).
 * Delegates to the access resolver so built-in defaults and custom-role
 * exceptions resolve in exactly one place.
 */
export function isActionAvailable(
  action: ManifestAction,
  role?: OrgRole,
  roleId?: string | null,
  customRoles?: Record<string, CustomRoleDef>,
): boolean {
  return canFor({ base: role, roleId }, action.id, customRoles);
}

// ---------------------------------------------------------------------------
// Surface queries
// ---------------------------------------------------------------------------

/** Get context menu actions for an entity type, filtered by role. */
export function getContextMenuActions(
  entityType: EntityType,
  options?: {
    role?: OrgRole;
    roleId?: string | null;
    isBulk?: boolean;
    customRoles?: Record<string, CustomRoleDef>;
  },
): ManifestAction[] {
  const results: ManifestAction[] = [];

  for (const feature of features) {
    for (const action of feature.actions) {
      if (!action.surfaces?.includes("context_menu")) continue;
      if (!action.entityTypes?.includes(entityType)) continue;
      if (options?.isBulk && !action.supportsBulk) continue;
      if (
        !isActionAvailable(
          action,
          options?.role,
          options?.roleId,
          options?.customRoles,
        )
      ) {
        continue;
      }
      results.push(action);
    }
  }

  return results;
}

// Re-export types and data
export { FEATURE_MANIFEST } from "./features";
export type { FeatureDomain } from "./features";
export type {
  FeatureEntry,
  ManifestAction,
  EntityType,
  ActionSurface,
  ActionId,
} from "./types";
export { ACTION_IDS } from "./types";
