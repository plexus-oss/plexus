/**
 * Auth wrappers for API route handlers.
 *
 * Each wrapper addresses a single concern:
 *
 *   withAuth(handler)              — Authentication: userId + orgId required
 *   withOrgAuth(handler)           — Authentication: orgId required, userId optional
 *   withRoleAuth(roles, handler)   — Authorization (RBAC): app role check
 *                                    (org_members table, provider-agnostic)
 *   withPlexusStaff(handler)       — Internal: Plexus staff access
 *   withDualAuth(handler, opts?)   — Dual: session OR API key auth
 *
 * Session reads go through getAuth() (lib/auth/session.ts).
 *
 * These are intentionally separate. Don't mix concerns into combined wrappers.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { apiError, errorResponse } from "./errors";
import { resolveOrgRoleFull } from "@/lib/auth/org-role";
import { canFor } from "@/lib/access/resolver";
import { loadRoleRegistry } from "@/lib/access/role-registry";
import type { OrgRole } from "./rbac";
import type { ActionId } from "@/lib/manifest/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteParams = Promise<Record<string, any>>;

export interface StaffAuthContext {
  userId: string;
  params: RouteParams;
}

type StaffAuthHandler = (
  request: Request,
  ctx: StaffAuthContext,
) => Promise<Response | NextResponse>;

export interface AuthContext {
  userId: string;
  orgId: string;
  /** Base built-in role (custom roles resolve to their base). */
  orgRole: string | undefined;
  /** Custom role id (org_roles.id) when the member holds one. */
  roleId?: string | null;
  params: RouteParams;
}

export interface OrgAuthContext {
  userId: string | null;
  orgId: string;
  orgRole: string | undefined;
  roleId?: string | null;
  params: RouteParams;
}

type AuthHandler = (
  request: Request,
  ctx: AuthContext,
) => Promise<Response | NextResponse>;

type OrgAuthHandler = (
  request: Request,
  ctx: OrgAuthContext,
) => Promise<Response | NextResponse>;

/**
 * Wrap an API route handler with auth (requires both userId AND orgId).
 * Catches errors and returns consistent 401/500 responses.
 */
export function withAuth(handler: AuthHandler) {
  return async (
    request: Request,
    routeCtx: { params: RouteParams },
  ): Promise<Response | NextResponse> => {
    try {
      const { userId, orgId, orgRole, roleId, impersonating } = await getAuth();
      if (!userId || !orgId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      // App-owned role, read from org_members (the session role is only a
      // hint). Impersonating staff keep the session role — resolveOrgRoleFull
      // would backfill them into the customer's org_members.
      const resolved = impersonating
        ? { base: orgRole ?? undefined, roleId: roleId ?? null }
        : await resolveOrgRoleFull(orgId, userId, orgRole);
      return await handler(request, {
        userId,
        orgId,
        orgRole: resolved.base,
        roleId: resolved.roleId,
        params: routeCtx.params,
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/**
 * Wrap an API route handler with org-only auth (userId optional).
 * Use for routes where the action is org-scoped but the actor is optional.
 */
export function withOrgAuth(handler: OrgAuthHandler) {
  return async (
    request: Request,
    routeCtx: { params: RouteParams },
  ): Promise<Response | NextResponse> => {
    try {
      const { userId, orgId, orgRole, impersonating } = await getAuth();
      if (!orgId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      // Anonymous org actors have no role; members resolve app-side.
      // Impersonating staff keep the session role (no org_members backfill).
      const resolved = userId
        ? impersonating
          ? { base: orgRole ?? undefined, roleId: null }
          : await resolveOrgRoleFull(orgId, userId, orgRole)
        : { base: undefined, roleId: null };
      return await handler(request, {
        userId: userId || null,
        orgId,
        orgRole: resolved.base,
        roleId: resolved.roleId,
        params: routeCtx.params,
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/**
 * Wrap an API route handler with auth + role check.
 * Only allows access for users with one of the specified roles.
 */
export function withRoleAuth(roles: string[], handler: AuthHandler) {
  return withAuth(async (request, ctx) => {
    if (!ctx.orgRole || !roles.includes(ctx.orgRole)) {
      throw apiError("FORBIDDEN", "Insufficient permissions");
    }
    return handler(request, ctx);
  });
}

/**
 * Permission-based authorization — the manifest-driven counterpart to
 * withRoleAuth. Built-in roles answer from the manifest threshold; custom
 * roles (ctx.roleId) answer from their exception set, falling back to their
 * base. This is the real security boundary for the Access matrix.
 *
 * Throws FORBIDDEN if the actor doesn't satisfy the requirement. Call inside
 * a withAuth handler, or use withPermission to wrap a route directly.
 */
export async function requirePermission(
  ctx: Pick<AuthContext, "orgId" | "orgRole"> & {
    userId?: string | null;
    roleId?: string | null;
  },
  actionId: ActionId,
): Promise<void> {
  const registry = ctx.roleId
    ? await loadRoleRegistry(ctx.orgId)
    : undefined;
  if (
    !canFor(
      { base: ctx.orgRole as OrgRole | undefined, roleId: ctx.roleId },
      actionId,
      registry,
    )
  ) {
    throw apiError("FORBIDDEN", "Insufficient permissions for this action");
  }
}

/**
 * Wrap an API route handler with auth + a manifest permission check.
 * Mirrors withRoleAuth but gates on a configurable action permission.
 */
export function withPermission(actionId: ActionId, handler: AuthHandler) {
  return withAuth(async (request, ctx) => {
    await requirePermission(ctx, actionId);
    return handler(request, ctx);
  });
}

/**
 * Wrap an API route handler with Plexus staff auth.
 * Only Plexus internal staff (users.is_staff === true) can access.
 * Does NOT require an orgId -- staff operate across orgs.
 *
 * Usage:
 *   export const GET = withPlexusStaff(async (req, { userId, params }) => {
 *     const { orgId } = await params;
 *     // ...
 *   });
 */
export function withPlexusStaff(handler: StaffAuthHandler) {
  return async (
    request: Request,
    routeCtx: { params: RouteParams },
  ): Promise<Response | NextResponse> => {
    try {
      const { userId } = await getAuth();
      if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      // Dynamic import to keep server-only module out of the static import graph
      const { isPlexusStaffById } = await import("@/lib/auth/plexus-staff");
      const staff = await isPlexusStaffById(userId);
      if (!staff) {
        throw apiError("FORBIDDEN", "Plexus staff access required");
      }
      return await handler(request, {
        userId,
        params: routeCtx.params,
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

// =============================================================================
// DUAL AUTH: Session + API Key
// =============================================================================

/**
 * Context for routes that accept both session auth and API key auth.
 * `isApiKeyAuth` indicates the auth method.
 */
export interface DualAuthContext {
  orgId: string;
  userId: string | undefined;
  orgRole: string | undefined;
  roleId?: string | null;
  isApiKeyAuth: boolean;
  params: RouteParams;
}

type DualAuthHandler = (
  request: NextRequest,
  ctx: DualAuthContext,
) => Promise<Response | NextResponse>;

/**
 * Wrap an API route handler with dual auth (session OR API key).
 *
 * Tries session auth first, then falls back to API key / device token.
 * When `allowInternalRequests` is true, also accepts trusted internal
 * requests identified by the x-internal-request + x-org-id headers.
 *
 * Usage:
 *   export const GET = withDualAuth(async (req, { orgId, isApiKeyAuth }) => {
 *     const queries = isApiKeyAuth ? adminQueries : queries;
 *     // ...
 *   });
 *
 *   // With internal request support (e.g. ingest → analyze pipeline)
 *   export const POST = withDualAuth(async (req, ctx) => { ... }, {
 *     allowInternalRequests: true,
 *   });
 */
export function withDualAuth(
  handler: DualAuthHandler,
  options?: { allowInternalRequests?: boolean; requiredScope?: string },
) {
  return async (
    request: NextRequest,
    routeCtx: { params: RouteParams },
  ): Promise<Response | NextResponse> => {
    try {
      // 1. Check for trusted internal requests (server-to-server)
      if (options?.allowInternalRequests) {
        const isInternal = request.headers.get("x-internal-request") === "true";
        const internalOrgId = request.headers.get("x-org-id");
        if (isInternal && internalOrgId) {
          return await handler(request, {
            orgId: internalOrgId,
            userId: undefined,
            orgRole: undefined,
            isApiKeyAuth: true,
            params: routeCtx.params,
          });
        }
      }

      // 2. Try session auth
      const session = await getAuth();
      if (session.orgId) {
        // Impersonating staff keep the session role (no org_members backfill).
        const resolved = session.userId
          ? session.impersonating
            ? { base: session.orgRole ?? undefined, roleId: null }
            : await resolveOrgRoleFull(
                session.orgId,
                session.userId,
                session.orgRole,
              )
          : { base: undefined, roleId: null };
        return await handler(request, {
          orgId: session.orgId,
          userId: session.userId || undefined,
          orgRole: resolved.base,
          roleId: resolved.roleId,
          isApiKeyAuth: false,
          params: routeCtx.params,
        });
      }

      // 3. Fall back to API key / device token auth
      // Dynamic import to keep server-only api-keys module out of static graph
      const { authenticateRequest, requireScope } =
        await import("@/lib/api-keys");
      const apiKeyResult = await authenticateRequest(request);
      if (apiKeyResult.success) {
        // Enforce scope if specified
        if (options?.requiredScope) {
          const scopeError = requireScope(apiKeyResult, options.requiredScope);
          if (scopeError) return scopeError;
        }

        return await handler(request, {
          orgId: apiKeyResult.orgId,
          userId: apiKeyResult.userId,
          orgRole: undefined,
          isApiKeyAuth: true,
          params: routeCtx.params,
        });
      }

      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
