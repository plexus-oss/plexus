/**
 * Access resolver — the single source of truth for "can this role do X".
 *
 * Built-in roles (Viewer/Editor/Admin) are FIXED: the manifest declares each
 * action's minimum role and that's that — the built-ins that ship with the
 * app are not editable. All customization lives in CUSTOM roles: a name, a
 * base role (viewer or editor), and per-action exceptions on top of the
 * base's defaults.
 *
 * Used by BOTH the server (enforcement — the real boundary) and the client
 * (UI gating — convenience only). Keeping one resolver avoids drift.
 */

import type { OrgRole } from "@/lib/api/rbac";
import type { ActionId, FeatureEntry } from "@/lib/manifest/types";
import { FEATURE_MANIFEST } from "@/lib/manifest/features";
import { meetsRole } from "./roles";

/** A custom role: base defaults + per-action exceptions. */
export interface CustomRoleDef {
  id: string;
  name: string;
  base: OrgRole; // org:viewer | org:editor (never admin)
  /** actionId → allowed, overriding the base's default for that action. */
  overrides: Record<string, boolean>;
}

/** The actor's role, resolved: base for rank checks + custom id when held. */
export interface RoleRef {
  base: OrgRole | undefined;
  roleId?: string | null;
}

/**
 * Actions whose required role can never be granted to non-admins.
 * Currently empty: the access-config surface is already hard-gated by
 * `withRoleAuth(["org:admin"])`.
 */
export const NON_OVERRIDABLE = new Set<ActionId>();

// Build the default lookup once from the manifest. Value is the action's
// declared `requiredRole`, or undefined (available to all).
const actionDefaults: Map<ActionId, OrgRole | undefined> = (() => {
  const map = new Map<ActionId, OrgRole | undefined>();
  for (const feature of Object.values(FEATURE_MANIFEST) as FeatureEntry[]) {
    for (const action of feature.actions) {
      map.set(action.id, action.requiredRole);
    }
  }
  return map;
})();

/** The manifest minimum role for an action (undefined = available to all). */
export function effectiveRequiredRole(
  actionId: ActionId,
): OrgRole | undefined {
  if (NON_OVERRIDABLE.has(actionId)) return "org:admin";
  return actionDefaults.get(actionId);
}

/**
 * THE check for built-in roles: the actor passes iff their role meets the
 * manifest threshold.
 */
export function can(role: OrgRole | undefined, actionId: ActionId): boolean {
  const required = effectiveRequiredRole(actionId);
  if (!required) return true; // no requirement → available to all
  return meetsRole(role, required);
}

/**
 * THE check, custom-role aware. A custom role answers from its exception
 * set first, then falls back to its base's default. Locked (NON_OVERRIDABLE)
 * actions ignore exceptions.
 */
export function canFor(
  ref: RoleRef,
  actionId: ActionId,
  customRoles?: Record<string, CustomRoleDef>,
): boolean {
  const def = ref.roleId ? customRoles?.[ref.roleId] : undefined;
  if (def && !NON_OVERRIDABLE.has(actionId)) {
    return def.overrides[actionId] ?? can(def.base, actionId);
  }
  return can(ref.base, actionId);
}

// ---------------------------------------------------------------------------
// Catalog — the manifest shaped for the Access matrix UI.
// ---------------------------------------------------------------------------

export interface CatalogAction {
  id: ActionId;
  label: string;
  /** Manifest minimum role (undefined = available to all). */
  defaultRequiredRole?: OrgRole;
  /** Whether this action is locked to admins (non-grantable). */
  locked: boolean;
  isDestructive?: boolean;
}

export interface CatalogFeature {
  domain: string;
  label: string;
  category: FeatureEntry["category"];
  actions: CatalogAction[];
}

export type AccessCatalog = CatalogFeature[];

/**
 * Build the permission catalog from the manifest, grouped by feature. Renders
 * the matrix entirely from data — new manifest actions appear automatically.
 */
export function buildCatalog(): AccessCatalog {
  const catalog: AccessCatalog = [];
  for (const [domain, feature] of Object.entries(FEATURE_MANIFEST) as [
    string,
    FeatureEntry,
  ][]) {
    const actions = feature.actions
      // matrix: false = navigation-only or resource-gated actions whose row
      // the server would ignore — keep them out of the matrix.
      .filter((action) => action.matrix !== false)
      .map(
        (action): CatalogAction => ({
          id: action.id,
          label: action.label,
          defaultRequiredRole: action.requiredRole,
          locked: NON_OVERRIDABLE.has(action.id),
          isDestructive: action.isDestructive,
        }),
      );
    if (actions.length > 0) {
      catalog.push({
        domain,
        label: feature.label,
        category: feature.category,
        actions,
      });
    }
  }
  return catalog;
}
