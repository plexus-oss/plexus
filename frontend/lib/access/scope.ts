/**
 * Effective visibility scope — the ONE rule for "what can this user see":
 *
 *   Scope is an allow-list of SOURCES on the member
 *   (`org_members.allowed_source_ids`). NULL = full access (the common
 *   case); a defined list (even empty) = restricted. Admins are NEVER
 *   scoped — enforced here, in one place, so no consumer can get it wrong.
 *
 * Picking an ENTITY source (minted by discovery, e.g. sat-25544) implies
 * row-filtered visibility of the CONNECTION it slices: the connection id is
 * derived into the visible set here, and lib/access/entity-scope.ts narrows
 * its query results to the picked entities' rows. `sourceIds` is therefore
 * what the viewer can SEE; `pickedSourceIds` is what they were literally
 * granted (full access) — entity-scope needs the distinction.
 *
 * Scope is set at invite time and edited in the member sheet. Permissions
 * ("what you can do") come from the org role — see lib/access/resolver.ts.
 */

import "server-only";

import { cache } from "react";
import { adminOrgMemberQueries } from "@/lib/db/server";
import { sourceAssociationQueries } from "@/lib/db/queries/sources";

export interface EffectiveScope {
  /**
   * Visible sources: the member's allow-list ∪ connections reachable via
   * picked entities (row-filtered). null = unrestricted.
   */
  sourceIds: Set<string> | null;
  /** The literal allow-list (full-access sources). null = unrestricted. */
  pickedSourceIds: Set<string> | null;
}

const UNRESTRICTED: EffectiveScope = { sourceIds: null, pickedSourceIds: null };

/** Per-request cached: one membership read (+ one association read if scoped). */
export const loadEffectiveScope = cache(
  async (orgId: string, userId: string): Promise<EffectiveScope> => {
    const member = await adminOrgMemberQueries.findScopeRow(orgId, userId);
    // No membership row (share-link viewers, staff) → nothing to scope by.
    if (!member || member.role === "org:admin") return UNRESTRICTED;
    if (member.allowed_source_ids == null) return UNRESTRICTED;

    const picked = new Set(member.allowed_source_ids.map(String));
    // Entities imply row-filtered visibility of their connections.
    const derivedConnections =
      await sourceAssociationQueries.findConnectionIdsForEntities(orgId, [
        ...picked,
      ]);
    return {
      sourceIds: new Set([...picked, ...derivedConnections]),
      pickedSourceIds: picked,
    };
  },
);
