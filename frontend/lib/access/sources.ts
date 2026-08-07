/**
 * Device (source) access resolver, built on the resource-access factory.
 * "Private = has a rule": a device is private when any grant names it —
 * directly (source_id) or via a fleet (source_group_id, dynamic membership
 * → covers current + future matching devices); otherwise it's org-visible.
 *
 * Enforcement is app-layer. Telemetry queries reference devices by SLUG while
 * grants are keyed by source UUID, so `filterAccessibleSlugs` bridges the two.
 */

import "server-only";

import { adminSourceGrantQueries } from "@/lib/db/server";
import { sourceQueries, sourceGroupQueries } from "@/lib/db/queries/sources";
import { apiError } from "@/lib/api/errors";
import { loadEffectiveScope } from "./scope";
import { canAccessResource, type AccessLevel } from "./shared";
import {
  createResourceAccess,
  type AccessCtx,
  type GrantRow,
} from "./resource-access";
import type { Source } from "@/lib/db/types";

/**
 * Effective source scoping for a user (see lib/access/scope.ts for the rule).
 * `null` = full org access (the common case); a Set (possibly empty) = the
 * user may see EXACTLY those source ids and nothing else. Cached per request.
 * This is the single source of truth for deny-by-default scoping — every
 * source chokepoint (filterAccessibleSlugs, enforceSource, the source list,
 * and the alert/event/monitor filters) consults it.
 */
export async function loadAllowedSourceIds(
  orgId: string,
  userId: string,
): Promise<Set<string> | null> {
  return (await loadEffectiveScope(orgId, userId)).sourceIds;
}

/**
 * True when the user is scoped and the source is NOT in their allow-list.
 * API-key callers (org automation) and userless contexts are never scoped;
 * admins are never scoped (enforced inside loadEffectiveScope).
 */
export async function isSourceOutOfScope(
  ctx: AccessCtx,
  sourceId: string,
): Promise<boolean> {
  if (ctx.isApiKeyAuth || !ctx.userId) return false;
  const allowed = await loadAllowedSourceIds(ctx.orgId, ctx.userId);
  return allowed != null && !allowed.has(sourceId);
}

export type { AccessLevel } from "./shared";
export type { AccessCtx } from "./resource-access";

/** Expand fleet ids to their current member device ids, deduped, in parallel. */
async function expandGroups(
  orgId: string,
  groupLevels: Map<string, AccessLevel>,
): Promise<GrantRow[]> {
  const expanded = await Promise.all(
    [...groupLevels.entries()].map(async ([groupId, level]) => {
      const groups = await sourceGroupQueries.findById(orgId, groupId);
      if (groups.length === 0) return []; // CASCADE-deleted; skip
      const members = await sourceGroupQueries.computeMembers(orgId, groups[0]);
      return members.map((m) => ({ resourceId: m.id, accessLevel: level }));
    }),
  );
  return expanded.flat();
}

const access = createResourceAccess({
  noun: "Device",

  loadGrantRows: async (orgId, userId, orgRole) => {
    const rows = await adminSourceGrantQueries.findSourceGrantsForUser(
      orgId,
      userId,
      orgRole,
    );

    const direct: GrantRow[] = [];
    const groupLevels = new Map<string, AccessLevel>();
    for (const row of rows) {
      if (row.source_id) {
        direct.push({
          resourceId: row.source_id,
          accessLevel: row.access_level,
        });
      } else if (row.source_group_id) {
        if (groupLevels.get(row.source_group_id) !== "edit") {
          groupLevels.set(
            row.source_group_id,
            row.access_level === "edit" ? "edit" : "view",
          );
        }
      }
    }
    return [...direct, ...(await expandGroups(orgId, groupLevels))];
  },

  loadPrivateIds: async (orgId) => {
    const targets = await adminSourceGrantQueries.findPermissionTargets(orgId);
    const ids = new Set<string>();
    const groupLevels = new Map<string, AccessLevel>();
    for (const t of targets) {
      if (t.source_id) ids.add(t.source_id);
      else if (t.source_group_id) groupLevels.set(t.source_group_id, "view");
    }
    for (const { resourceId } of await expandGroups(orgId, groupLevels)) {
      ids.add(resourceId);
    }
    return ids;
  },
});

/** sourceId → most-permissive grant level for the user. */
export const loadUserSourceGrants = access.loadUserGrants;
/** Devices named by any rule (directly or via a fleet) → private. */
export const loadPrivateSourceIds = access.loadPrivateIds;
export const assertSourceAccess = access.assertAccess;

/**
 * Per-resource gate for a single source. Applies user scoping first (a scoped
 * user can't even see existence → NOT_FOUND), then the normal grant cascade.
 */
export async function enforceSource(
  ctx: AccessCtx,
  resource: { id: string; created_by: string | null },
  need: AccessLevel,
): Promise<void> {
  if (await isSourceOutOfScope(ctx, resource.id)) {
    throw apiError("NOT_FOUND", "Device not found");
  }
  return access.enforce(ctx, resource, need);
}

/** Pure decision — admin and creator always pass. */
export function canAccessSource(args: {
  orgRole: string | undefined;
  userId: string | undefined;
  source: { id: string; created_by: string | null };
  isPrivate: boolean;
  grants: Map<string, AccessLevel>;
  need: AccessLevel;
}): boolean {
  return canAccessResource({
    orgRole: args.orgRole,
    userId: args.userId,
    resource: args.source,
    isPrivate: args.isPrivate,
    grants: args.grants,
    need: args.need,
  });
}

/**
 * Telemetry bridge: given device slugs, return the subset the user may view.
 * API-key callers and admins get everything; the "*" wildcard is the caller's
 * responsibility to gate. Slugs with no `sources` row are public (allowed) —
 * UNLESS the user is scoped, in which case they see only their allow-listed
 * sources and nothing else (deny-by-default, applied even on the fast path).
 */
export async function filterAccessibleSlugs(
  ctx: AccessCtx,
  slugs: string[],
): Promise<Set<string>> {
  const unique = [...new Set(slugs.filter((s) => s && s !== "*"))];
  if (ctx.isApiKeyAuth || !ctx.userId || ctx.orgRole === "org:admin") {
    return new Set(unique);
  }

  // Scoping (external/guest users): a non-null allow-list means deny-by-default
  // — only allow-listed sources are ever visible, regardless of public/private.
  const allowed = await loadAllowedSourceIds(ctx.orgId, ctx.userId);

  const sources = (await sourceQueries.findBySlugs(
    ctx.orgId,
    unique,
  )) as Source[];
  const foundSlugs = new Set(sources.map((s) => s.slug));

  const ok = new Set<string>();
  // A slug with no `sources` row can't be private (nothing to attach a rule to)
  // — it's org-visible, as it was before access control existed. Scoped users,
  // however, see nothing outside their satellites, so unknown slugs are denied.
  if (!allowed) {
    for (const slug of unique) if (!foundSlugs.has(slug)) ok.add(slug);
  }

  // Grants only matter when the org has private sources; skip the load otherwise.
  const privateIds = await loadPrivateSourceIds(ctx.orgId);
  const grants =
    privateIds.size > 0
      ? await loadUserSourceGrants(
          ctx.orgId,
          ctx.userId,
          ctx.roleId ?? ctx.orgRole,
        )
      : null;

  for (const s of sources) {
    if (allowed && !allowed.has(s.id)) continue; // scope gate (deny-by-default)
    if (!grants) {
      ok.add(s.slug); // no private sources in org → public-visible
      continue;
    }
    if (
      canAccessSource({
        orgRole: ctx.orgRole,
        userId: ctx.userId,
        source: s,
        isPrivate: privateIds.has(s.id),
        grants,
        need: "view",
      })
    ) {
      ok.add(s.slug);
    }
  }
  return ok;
}
