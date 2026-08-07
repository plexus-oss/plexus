/**
 * Group resource-grant queries (unified RBAC "groups" model).
 *
 * A group is an org ROLE (`role` grantee column). A group's access spans the
 * permissions tables; this module presents them as one unified "grants" list
 * keyed by `kind`, with resource names resolved for display. All kind-specific
 * knowledge (tables, columns, labels) lives in the resource-kind registry —
 * add a kind there and these queries just work.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { resolveTable } from "./shared";
import { apiError } from "@/lib/api/errors";
import {
  RESOURCE_KINDS,
  ALL_GRANT_KINDS,
  type GrantKind,
} from "@/lib/access/resource-kinds";
import type { ShareLinkAccess } from "../types";

export type { GrantKind };

/** A grant's subject: a built-in org role or a custom role id. */
export type GroupRef = { kind: "role"; role: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GroupGrant {
  id: string;
  kind: GrantKind;
  resourceId: string;
  resourceName: string;
  accessLevel: ShareLinkAccess;
}

/**
 * Decode a `groupId` URL segment into a GroupRef. Role keywords
 * ("viewer"/"editor"/"admin") map to built-ins; a UUID is a custom role id
 * (existence is validated when a grant is written).
 */
export function parseGroupId(groupId: string): GroupRef {
  if (groupId === "viewer" || groupId === "editor" || groupId === "admin") {
    return { kind: "role", role: `org:${groupId}` };
  }
  if (UUID_RE.test(groupId)) {
    return { kind: "role", role: groupId };
  }
  throw apiError("NOT_FOUND", "Unknown group");
}

/**
 * Guard a grant's targets before insert: the resource must exist and belong
 * to the org, and a custom-role subject must be a real org role. Without
 * this, a bogus UUID inserts silently and surfaces later as a ghost row.
 */
async function assertGrantTargets(
  orgId: string,
  ref: GroupRef,
  kind: GrantKind,
  resourceId: string,
): Promise<void> {
  if (!ref.role.startsWith("org:")) {
    const orgRoles = resolveTable("org_roles");
    const roleRows = await db
      .select({ id: orgRoles.id })
      .from(orgRoles)
      .where(and(eq(orgRoles.org_id, orgId), eq(orgRoles.id, ref.role)))
      .limit(1);
    if (!roleRows.length) throw apiError("NOT_FOUND", "Role not found");
  }

  const resourceTable = resolveTable(RESOURCE_KINDS[kind].table);
  const resourceRows = await db
    .select({ id: resourceTable.id })
    .from(resourceTable)
    .where(and(eq(resourceTable.org_id, orgId), eq(resourceTable.id, resourceId)))
    .limit(1);
  if (!resourceRows.length) {
    throw apiError("NOT_FOUND", `${RESOURCE_KINDS[kind].label} not found`);
  }
}

export const groupGrantQueries = {
  list: async (orgId: string, ref: GroupRef): Promise<GroupGrant[]> => {
    // One grant query per permissions table (kinds can share a table).
    const tables = [
      ...new Set(ALL_GRANT_KINDS.map((k) => RESOURCE_KINDS[k].permissionsTable)),
    ];
    const grantRows = new Map<
      string,
      { id: string; access_level: ShareLinkAccess; [col: string]: unknown }[]
    >();
    await Promise.all(
      tables.map(async (tableName) => {
        // select * and read the kind-specific grant columns dynamically — the
        // set of columns varies by table, so a fixed projection won't do.
        const table = resolveTable(tableName);
        const data = await db
          .select()
          .from(table)
          .where(and(eq(table.org_id, orgId), eq(table.role, ref.role)));
        grantRows.set(tableName, data as never);
      }),
    );

    // Bucket rows by kind via their grant column, then resolve names per kind.
    const grants: GroupGrant[] = [];
    await Promise.all(
      ALL_GRANT_KINDS.map(async (kind) => {
        const meta = RESOURCE_KINDS[kind];
        const rows = (grantRows.get(meta.permissionsTable) ?? []).filter(
          (r) => r[meta.grantColumn],
        );
        if (rows.length === 0) return;

        const ids = rows.map((r) => r[meta.grantColumn] as string);
        const resourceTable = resolveTable(meta.table);
        const data = await db
          .select()
          .from(resourceTable)
          .where(and(eq(resourceTable.org_id, orgId), inArray(resourceTable.id, ids)));
        const names = new Map(
          (data as { id: string; name: string | null; slug?: string }[]).map(
            (r) => [r.id, r.name || r.slug || ""],
          ),
        );

        for (const r of rows) {
          const resourceId = r[meta.grantColumn] as string;
          grants.push({
            id: r.id,
            kind,
            resourceId,
            resourceName:
              names.get(resourceId) || `(deleted ${meta.label.toLowerCase()})`,
            accessLevel: r.access_level,
          });
        }
      }),
    );
    return grants;
  },

  add: async (
    orgId: string,
    ref: GroupRef,
    kind: GrantKind,
    resourceId: string,
    accessLevel: ShareLinkAccess,
    invitedBy: string,
  ): Promise<void> => {
    await assertGrantTargets(orgId, ref, kind, resourceId);
    const meta = RESOURCE_KINDS[kind];
    const table = resolveTable(meta.permissionsTable);
    try {
      await db.insert(table).values({
        org_id: orgId,
        [meta.grantColumn]: resourceId,
        role: ref.role,
        access_level: accessLevel,
        invited_by: invitedBy,
      });
    } catch (err) {
      // 23505 = unique violation → grant already exists; treat as success.
      if ((err as { code?: string }).code !== "23505") throw err;
    }
  },

  update: async (
    orgId: string,
    kind: GrantKind,
    grantId: string,
    accessLevel: ShareLinkAccess,
  ): Promise<void> => {
    const table = resolveTable(RESOURCE_KINDS[kind].permissionsTable);
    const updated = await db
      .update(table)
      .set({ access_level: accessLevel })
      .where(and(eq(table.org_id, orgId), eq(table.id, grantId)))
      .returning({ id: table.id });
    // Zero rows = the grantId doesn't live in `kind`'s table (caller bug) or
    // was already removed — fail loudly instead of silently no-oping.
    if (!updated.length) throw apiError("NOT_FOUND", "Grant not found");
  },

  remove: async (
    orgId: string,
    kind: GrantKind,
    grantId: string,
  ): Promise<void> => {
    const table = resolveTable(RESOURCE_KINDS[kind].permissionsTable);
    const deleted = await db
      .delete(table)
      .where(and(eq(table.org_id, orgId), eq(table.id, grantId)))
      .returning({ id: table.id });
    if (!deleted.length) throw apiError("NOT_FOUND", "Grant not found");
  },
};
