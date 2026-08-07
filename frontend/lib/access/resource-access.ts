/**
 * Resource-access factory — builds the standard access toolkit (grant loader,
 * private-id loader, assert, enforce) for one grantable resource family.
 *
 * Every resource resolves access the same way:
 *   1. load the caller's grants (direct + role-targeted, folded
 *      most-permissive),
 *   2. derive privacy ("private = has a rule"),
 *   3. decide via the shared `canAccessResource` cascade
 *      (admin → creator → public/private → grants).
 *
 * Only the grant/private QUERIES differ per resource (e.g. devices expand
 * fleet grants to member devices) — so that's all a config supplies. The
 * loaders are wrapped in React cache() for per-request memoization.
 */

import "server-only";

import { cache } from "react";
import {
  canAccessResource,
  assertResourceAccess,
  foldGrant,
  type AccessLevel,
  type AccessResource,
} from "./shared";

export interface GrantRow {
  resourceId: string;
  accessLevel: AccessLevel;
}

export interface AccessCtx {
  orgId: string;
  userId: string | undefined;
  /** Base built-in role (custom roles resolve to their base). */
  orgRole: string | undefined;
  /** Custom role id, when held — matches role-targeted grants. */
  roleId?: string | null;
  isApiKeyAuth: boolean;
}

export interface ResourceAccessConfig {
  /** Human noun for error messages ("Device", "Dashboard"). */
  noun: string;
  /**
   * Every grant row that applies to the user (direct user_id or their org
   * role), already expanded to concrete resource ids.
   */
  loadGrantRows: (
    orgId: string,
    userId: string,
    orgRole?: string,
  ) => Promise<GrantRow[]>;
  /** Ids of resources named by ANY rule in the org → private. */
  loadPrivateIds: (orgId: string) => Promise<Set<string>>;
}

export function createResourceAccess(config: ResourceAccessConfig) {
  /** resourceId → the user's most-permissive grant level. */
  const loadUserGrants = cache(
    async (
      orgId: string,
      userId: string,
      orgRole?: string,
    ): Promise<Map<string, AccessLevel>> => {
      const rows = await config.loadGrantRows(orgId, userId, orgRole);
      const grants = new Map<string, AccessLevel>();
      for (const row of rows) foldGrant(grants, row.resourceId, row.accessLevel);
      return grants;
    },
  );

  /** Resources with any access rule → private. Empty in the common case. */
  const loadPrivateIds = cache(config.loadPrivateIds);

  /** NOT_FOUND when the user can't view (don't leak existence); FORBIDDEN on edit-deny. */
  function assertAccess(
    ctx: { orgRole: string | undefined; userId: string | undefined },
    resource: AccessResource,
    isPrivate: boolean,
    grants: Map<string, AccessLevel>,
    need: AccessLevel,
  ): void {
    assertResourceAccess(config.noun, ctx, resource, isPrivate, grants, need);
  }

  /** Convenience: load + assert for session callers (API-key bypasses). */
  async function enforce(
    ctx: AccessCtx,
    resource: AccessResource,
    need: AccessLevel,
  ): Promise<void> {
    if (ctx.isApiKeyAuth || !ctx.userId) return;
    const privateIds = await loadPrivateIds(ctx.orgId);
    const isPrivate = privateIds.has(resource.id);
    // Grants only matter for private resources; public access is decided by
    // role/creator alone, so skip the grant load in the common case.
    // Custom-role holders match grants targeting their role id ONLY (matrix
    // columns are independent — a Customer doesn't inherit Viewer grants).
    const grants = isPrivate
      ? await loadUserGrants(ctx.orgId, ctx.userId, ctx.roleId ?? ctx.orgRole)
      : new Map<string, AccessLevel>();
    assertAccess(
      { orgRole: ctx.orgRole, userId: ctx.userId },
      resource,
      isPrivate,
      grants,
      need,
    );
  }

  return {
    loadUserGrants,
    loadPrivateIds,
    canAccess: canAccessResource,
    assertAccess,
    enforce,
  };
}
