/**
 * Server-Only Database Operations
 *
 * Admin (no-RLS) database operations on the Drizzle pool. These run for any org
 * without a user session — API-key validation, Stripe/billing writes, the
 * alert-service bootstrap, and other service-to-service paths — so they must
 * NEVER be imported in client-side code.
 *
 * For session-scoped database operations, use the exports from "@/lib/db".
 */

import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  like,
  or,
  sql,
} from "drizzle-orm";

import { db } from "./client";
import { isUuid } from "@/lib/utils/uuid";
// Drizzle tables — grown as admin objects are ported off Supabase.
import {
  apiKeys,
  orgRoles,
  orgRolePermissions,
  orgMembers,
  orgBilling,
  sources,
  dashboardPermissions,
  sourcePermissions,
  sourceLimits,
  eventMonitors,
  alertRules,
  dashboards,
  dashboardShareLinks,
  dashboardViews,
  alerts,
  alertEvents,
  sourceContext,
  deviceSchemas,
} from "./schema";
import type {
  Database,
  Source,
  SourceType,
  SourceStatus,
  ConnectionType,
  Dashboard,
  DashboardShareLink,
  DashboardView,
  NewDashboardView,
  Alert,
  NewAlert,
  AlertEvent,
  AlertEventType,
  AlertRuleType,
  SourceContext,
  DeviceSchemaRecord,
  EventMonitorRecord,
  ApiKey,
  VerdictStats,
} from "./types";
import {
  tallyVerdicts,
  VERDICT_WINDOW_DAYS,
  VERDICT_SAMPLE,
} from "@/lib/alerts/verdicts";

export type OrgBillingRow = Database["public"]["Tables"]["org_billing"]["Row"];
export type OrgBillingUpdate =
  Database["public"]["Tables"]["org_billing"]["Update"];

// =============================================================================
// ADMIN API KEY QUERIES (for API key validation - no user session available)
// =============================================================================

export const adminApiKeyQueries = {
  findByHash: async (keyHash: string) => {
    // Returns all columns incl. access_enabled — the soft billing gate that
    // verify-key honors. (An older comment here claimed no soft-revoke column
    // existed; it does — schema.ts api_keys.access_enabled, default true.)
    return db.select().from(apiKeys).where(eq(apiKeys.key_hash, keyHash));
  },

  updateLastUsed: async (id: string) => {
    return db
      .update(apiKeys)
      .set({ last_used_at: new Date().toISOString() })
      .where(eq(apiKeys.id, id))
      .returning();
  },

  insert: async (
    orgId: string,
    data: {
      name: string;
      key_prefix: string;
      key_hash: string;
      scopes: string[];
      expires_at: string | null;
      access_enabled?: boolean;
    },
  ): Promise<ApiKey[]> => {
    const result = await db
      .insert(apiKeys)
      .values({ ...data, org_id: orgId })
      .returning();
    return result as ApiKey[];
  },

  /**
   * Set access_enabled on every key for an org. Called by syncApiKeyAccess
   * in response to billing events (subscription changes, card add/remove).
   */
  setAccessEnabledForOrg: async (
    orgId: string,
    enabled: boolean,
  ): Promise<number> => {
    const rows = await db
      .update(apiKeys)
      .set({ access_enabled: enabled })
      .where(eq(apiKeys.org_id, orgId))
      .returning({ id: apiKeys.id });
    return rows.length;
  },

  /**
   * Hard-delete every key for an org. Reserved for genuine account/org
   * deletion where the keys should never come back. Billing enforcement no
   * longer uses this — it soft-disables via access_enabled so keys survive
   * and restore instantly on payment (see disableAllForOrgAndCollect).
   */
  revokeAllForOrg: async (orgId: string): Promise<number> => {
    const rows = await db
      .delete(apiKeys)
      .where(eq(apiKeys.org_id, orgId))
      .returning({ id: apiKeys.id });
    return rows.length;
  },

  /**
   * Soft-disable every currently-enabled key for an org and return the ids
   * that were flipped. Called by the spend-cap / team-tier breach enforcers:
   * ingest stops (verify-key returns 403 on access_enabled=false) without
   * deleting the row, so setAccessEnabledByIds(ids, true) restores exactly
   * these keys on payment — no re-mint, no device re-flash. Filtering on
   * access_enabled=true means we only collect keys we actually disabled, so
   * restore never re-enables a key some other path had disabled.
   */
  disableAllForOrgAndCollect: async (orgId: string): Promise<string[]> => {
    const rows = await db
      .update(apiKeys)
      .set({ access_enabled: false })
      .where(and(eq(apiKeys.org_id, orgId), eq(apiKeys.access_enabled, true)))
      .returning({ id: apiKeys.id });
    return rows.map((row) => row.id);
  },

  /**
   * Set access_enabled on a specific set of key ids. Used by the breach
   * enforcers to restore exactly the keys they disabled.
   */
  setAccessEnabledByIds: async (
    ids: string[],
    enabled: boolean,
  ): Promise<number> => {
    if (ids.length === 0) return 0;
    const rows = await db
      .update(apiKeys)
      .set({ access_enabled: enabled })
      .where(inArray(apiKeys.id, ids))
      .returning({ id: apiKeys.id });
    return rows.length;
  },

  deleteById: async (id: string): Promise<void> => {
    await db.delete(apiKeys).where(eq(apiKeys.id, id));
  },
};

// =============================================================================
// ADMIN CUSTOM-ROLE QUERIES (RBAC — read on every enforced request for custom
// role holders, so service role avoids RLS round-trips)
// =============================================================================

export interface OrgRoleRow {
  id: string;
  org_id: string;
  name: string;
  base_role: string;
  description: string | null;
}

export const adminOrgRoleQueries = {
  findAll: async (orgId: string): Promise<OrgRoleRow[]> =>
    (await db
      .select({
        id: orgRoles.id,
        org_id: orgRoles.org_id,
        name: orgRoles.name,
        base_role: orgRoles.base_role,
        description: orgRoles.description,
      })
      .from(orgRoles)
      .where(eq(orgRoles.org_id, orgId))
      .orderBy(asc(orgRoles.created_at))) as OrgRoleRow[],

  findById: async (orgId: string, id: string): Promise<OrgRoleRow | null> => {
    const rows = await db
      .select({
        id: orgRoles.id,
        org_id: orgRoles.org_id,
        name: orgRoles.name,
        base_role: orgRoles.base_role,
        description: orgRoles.description,
      })
      .from(orgRoles)
      .where(and(eq(orgRoles.org_id, orgId), eq(orgRoles.id, id)))
      .limit(1);
    return (rows[0] ?? null) as OrgRoleRow | null;
  },

  create: async (
    orgId: string,
    data: { name: string; base_role: string; created_by: string | null },
  ): Promise<OrgRoleRow> => {
    const [row] = await db
      .insert(orgRoles)
      .values({ org_id: orgId, ...data })
      .returning();
    return row as OrgRoleRow;
  },

  rename: async (orgId: string, id: string, name: string): Promise<void> => {
    await db
      .update(orgRoles)
      .set({ name, updated_at: new Date().toISOString() })
      .where(and(eq(orgRoles.org_id, orgId), eq(orgRoles.id, id)));
  },

  delete: async (orgId: string, id: string): Promise<void> => {
    await db
      .delete(orgRoles)
      .where(and(eq(orgRoles.org_id, orgId), eq(orgRoles.id, id)));
  },

  /** All per-action exceptions for the org's custom roles (one read). */
  findAllOverrides: async (
    orgId: string,
  ): Promise<{ role_id: string; action_id: string; allowed: boolean }[]> =>
    (await db
      .select({
        role_id: orgRolePermissions.role_id,
        action_id: orgRolePermissions.action_id,
        allowed: orgRolePermissions.allowed,
      })
      .from(orgRolePermissions)
      .where(eq(orgRolePermissions.org_id, orgId))) as {
      role_id: string;
      action_id: string;
      allowed: boolean;
    }[],

  /**
   * Apply a batch of exception changes for one role: boolean = set the
   * exception, null = clear it (fall back to the base default).
   */
  applyOverrides: async (
    orgId: string,
    roleId: string,
    changes: Record<string, boolean | null>,
  ): Promise<void> => {
    for (const [actionId, allowed] of Object.entries(changes)) {
      if (allowed === null) {
        await db
          .delete(orgRolePermissions)
          .where(
            and(
              eq(orgRolePermissions.role_id, roleId),
              eq(orgRolePermissions.action_id, actionId),
            ),
          );
      } else {
        await db
          .insert(orgRolePermissions)
          .values({
            org_id: orgId,
            role_id: roleId,
            action_id: actionId,
            allowed,
          })
          .onConflictDoUpdate({
            target: [orgRolePermissions.role_id, orgRolePermissions.action_id],
            set: { allowed },
          });
      }
    }
  },

  /** Members currently holding this custom role (org_members.role = role id). */
  countMembers: async (orgId: string, roleId: string): Promise<number> => {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(orgMembers)
      .where(and(eq(orgMembers.org_id, orgId), eq(orgMembers.role, roleId)));
    return count ?? 0;
  },

  /** Move every member of a role to another role value (built-in or custom). */
  reassignMembers: async (
    orgId: string,
    fromRoleId: string,
    toRole: string,
  ): Promise<void> => {
    await db
      .update(orgMembers)
      .set({ role: toRole })
      .where(
        and(eq(orgMembers.org_id, orgId), eq(orgMembers.role, fromRoleId)),
      );
  },
};

// =============================================================================
// ADMIN ORG MEMBER QUERIES (app-owned roles — read on every authed request;
// service role because role resolution runs before any RLS context exists)
// =============================================================================

export type OrgMemberRow = Database["public"]["Tables"]["org_members"]["Row"];

export const adminOrgMemberQueries = {
  /** The member's app role, or null if no row exists yet. */
  findRole: async (orgId: string, userId: string): Promise<string | null> => {
    const rows = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.org_id, orgId), eq(orgMembers.user_id, userId)))
      .limit(1);
    return rows[0]?.role ?? null;
  },

  /**
   * Role + the scoping allow-list in one read — feeds the effective scope in
   * lib/access/scope.ts (which needs the role for the admin bypass).
   */
  findScopeRow: async (
    orgId: string,
    userId: string,
  ): Promise<{
    role: string;
    allowed_source_ids: string[] | null;
  } | null> => {
    const rows = await db
      .select({
        role: orgMembers.role,
        allowed_source_ids: orgMembers.allowed_source_ids,
      })
      .from(orgMembers)
      .where(and(eq(orgMembers.org_id, orgId), eq(orgMembers.user_id, userId)))
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * Source-scoping list for a member. `null` = full org access (the default
   * and the common case); a (possibly empty) array = restricted to exactly
   * those source ids. Drives deny-by-default access in lib/access/sources.ts.
   */
  findAllowedSourceIds: async (
    orgId: string,
    userId: string,
  ): Promise<string[] | null> => {
    const rows = await db
      .select({ allowed: orgMembers.allowed_source_ids })
      .from(orgMembers)
      .where(and(eq(orgMembers.org_id, orgId), eq(orgMembers.user_id, userId)))
      .limit(1);
    return rows[0]?.allowed ?? null;
  },

  /** Set (or clear with `null`) a member's source scoping. Admin-gated upstream. */
  setAllowedSourceIds: async (
    orgId: string,
    userId: string,
    allowed: string[] | null,
  ): Promise<void> => {
    await db
      .update(orgMembers)
      .set({ allowed_source_ids: allowed })
      .where(and(eq(orgMembers.org_id, orgId), eq(orgMembers.user_id, userId)));
  },

  /**
   * Lazy bootstrap — insert only if absent so a concurrent webhook write
   * (which is authoritative) is never clobbered.
   */
  insertIfAbsent: async (
    orgId: string,
    userId: string,
    role: string,
  ): Promise<void> => {
    await db
      .insert(orgMembers)
      .values({ org_id: orgId, user_id: userId, role })
      .onConflictDoNothing({ target: [orgMembers.org_id, orgMembers.user_id] });
  },

  /** Return the admin (or oldest member) email + first_name for an org. */
  findAdminByOrg: async (
    orgId: string,
  ): Promise<{ email: string; firstName: string | null } | null> => {
    const sel = { email: orgMembers.email, first_name: orgMembers.first_name };

    const admins = await db
      .select(sel)
      .from(orgMembers)
      .where(
        and(
          eq(orgMembers.org_id, orgId),
          eq(orgMembers.role, "org:admin"),
          isNotNull(orgMembers.email),
        ),
      )
      .limit(1);

    let row = admins[0];
    if (!row) {
      const members = await db
        .select(sel)
        .from(orgMembers)
        .where(and(eq(orgMembers.org_id, orgId), isNotNull(orgMembers.email)))
        .orderBy(asc(orgMembers.created_at))
        .limit(1);
      row = members[0];
    }

    if (!row?.email) return null;
    return { email: row.email, firstName: row.first_name ?? null };
  },

  /** All memberships for one user, oldest org first (deterministic default). */
  findByUser: async (
    userId: string,
  ): Promise<Pick<OrgMemberRow, "org_id" | "role" | "created_at">[]> =>
    (await db
      .select({
        org_id: orgMembers.org_id,
        role: orgMembers.role,
        created_at: orgMembers.created_at,
      })
      .from(orgMembers)
      .where(eq(orgMembers.user_id, userId))
      .orderBy(asc(orgMembers.created_at))) as Pick<
      OrgMemberRow,
      "org_id" | "role" | "created_at"
    >[],

  /** Single membership lookup — the server-side active-org validation. */
  findMembership: async (
    orgId: string,
    userId: string,
  ): Promise<OrgMemberRow | null> => {
    const rows = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.org_id, orgId), eq(orgMembers.user_id, userId)))
      .limit(1);
    return (rows[0] ?? null) as OrgMemberRow | null;
  },

  /** Resolve member profiles for an org, e.g. activity-feed actors. */
  findByUserIds: async (
    orgId: string,
    userIds: string[],
  ): Promise<OrgMemberRow[]> => {
    if (userIds.length === 0) return [];
    return (await db
      .select()
      .from(orgMembers)
      .where(
        and(eq(orgMembers.org_id, orgId), inArray(orgMembers.user_id, userIds)),
      )) as OrgMemberRow[];
  },

  /** Full upsert including identity columns (member identity sync). */
  upsert: async (
    orgId: string,
    userId: string,
    data: {
      email?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      image_url?: string | null;
      role?: string;
      allowed_source_ids?: string[] | null;
    },
  ): Promise<void> => {
    await db
      .insert(orgMembers)
      .values({ org_id: orgId, user_id: userId, ...data })
      .onConflictDoUpdate({
        target: [orgMembers.org_id, orgMembers.user_id],
        set: data,
      });
  },

  /** Remove a member's row (admin removal). */
  delete: async (orgId: string, userId: string): Promise<void> => {
    await db
      .delete(orgMembers)
      .where(and(eq(orgMembers.org_id, orgId), eq(orgMembers.user_id, userId)));
  },
};

// =============================================================================
// ADMIN DASHBOARD-GRANT QUERIES (read on enforced requests; service role keeps
// one code path regardless of RLS context)
// =============================================================================

export interface DashboardGrantRow {
  dashboard_id: string;
  access_level: "view" | "edit";
}

export const adminDashboardGrantQueries = {
  /**
   * Every dashboard grant that applies to the user: direct user_id rows plus
   * rows targeting their org role. The caller folds to most-permissive.
   */
  findDashboardGrantsForUser: async (
    orgId: string,
    userId: string,
    orgRole?: string,
  ): Promise<DashboardGrantRow[]> => {
    // OR: direct user grant or their role — all bound.
    const matches = [eq(dashboardPermissions.user_id, userId)];
    if (orgRole) matches.push(eq(dashboardPermissions.role, orgRole));
    return (await db
      .select({
        dashboard_id: dashboardPermissions.dashboard_id,
        access_level: dashboardPermissions.access_level,
      })
      .from(dashboardPermissions)
      .where(
        and(eq(dashboardPermissions.org_id, orgId), or(...matches)),
      )) as DashboardGrantRow[];
  },

  /** Dashboards that have any access rule → private (rule-based visibility). */
  findPrivateDashboardIds: async (orgId: string): Promise<string[]> => {
    const rows = await db
      .select({ dashboard_id: dashboardPermissions.dashboard_id })
      .from(dashboardPermissions)
      .where(
        and(
          eq(dashboardPermissions.org_id, orgId),
          isNotNull(dashboardPermissions.dashboard_id),
        ),
      );
    return rows.map((r) => r.dashboard_id).filter((id): id is string => !!id);
  },
};

export interface SourceGrantRow {
  source_id: string | null;
  source_group_id: string | null;
  access_level: "view" | "edit";
}

export const adminSourceGrantQueries = {
  /** Every source grant for the user: direct user_id rows + role-targeted rows. */
  findSourceGrantsForUser: async (
    orgId: string,
    userId: string,
    orgRole?: string,
  ): Promise<SourceGrantRow[]> => {
    const matches = [eq(sourcePermissions.user_id, userId)];
    if (orgRole) matches.push(eq(sourcePermissions.role, orgRole));
    return (await db
      .select({
        source_id: sourcePermissions.source_id,
        source_group_id: sourcePermissions.source_group_id,
        access_level: sourcePermissions.access_level,
      })
      .from(sourcePermissions)
      .where(
        and(eq(sourcePermissions.org_id, orgId), or(...matches)),
      )) as SourceGrantRow[];
  },

  /**
   * All resource targets named by any source rule in the org — used to derive
   * which devices are private. Returns the direct source_ids and the
   * source_group_ids (the caller expands groups to member devices).
   */
  findPermissionTargets: async (
    orgId: string,
  ): Promise<{ source_id: string | null; source_group_id: string | null }[]> =>
    (await db
      .select({
        source_id: sourcePermissions.source_id,
        source_group_id: sourcePermissions.source_group_id,
      })
      .from(sourcePermissions)
      .where(eq(sourcePermissions.org_id, orgId))) as {
      source_id: string | null;
      source_group_id: string | null;
    }[],
};

// =============================================================================
// ADMIN SOURCE QUERIES (for source token validation - no user session available)
// =============================================================================

export const adminSourceQueries = {
  count: async (orgId: string): Promise<number> => {
    const r = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(sources)
      .where(eq(sources.org_id, orgId));
    return r[0]?.count ?? 0;
  },

  findBySlug: async (orgId: string, slug: string): Promise<Source[]> =>
    (await db
      .select()
      .from(sources)
      .where(
        and(eq(sources.org_id, orgId), eq(sources.slug, slug)),
      )) as Source[],

  /**
   * Lookup by slug across every org. Staff-only paths use this to act on
   * demo sources where the orgId isn't known from the request context.
   * Demo slugs are prefixed (`demo-<prospect>-`) so collisions are rare,
   * but this may still return multiple rows — caller should iterate.
   */
  findBySlugAcrossOrgs: async (slug: string): Promise<Source[]> =>
    (await db.select().from(sources).where(eq(sources.slug, slug))) as Source[],

  findById: async (id: string): Promise<Source | null> => {
    const rows = await db
      .select()
      .from(sources)
      .where(eq(sources.id, id))
      .limit(1);
    return (rows[0] ?? null) as Source | null;
  },

  /**
   * THE bridge for the two `source_id` conventions in the schema:
   * `alert_rules.source_id` is the source SLUG (migration 00037 dropped its FK),
   * while everything else (`sources.id`, `alerts.source_id`, `source_limits`,
   * `event_monitors` — real UUID FKs since migration 0013) is the UUID. Accepts
   * EITHER form and returns the full source row, so any caller gets both `.slug`
   * (to store on an alert_rule) and `.id` (for the UUID tables) from one lookup.
   * Use this (or lib/api/find-source.ts at route boundaries) instead of
   * hand-rolling slug↔uuid resolution — that drift is what hid offline monitors
   * from the UI. Limitation: a uuid-shaped ref is only looked up as an id, so
   * uuid-shaped slugs are unreachable; source creation rejects them.
   */
  resolveRef: async (
    orgId: string,
    uuidOrSlug: string,
  ): Promise<Source | null> => {
    const col = isUuid(uuidOrSlug) ? sources.id : sources.slug;
    const rows = await db
      .select()
      .from(sources)
      .where(and(eq(sources.org_id, orgId), eq(col, uuidOrSlug)))
      .limit(1);
    return (rows[0] ?? null) as Source | null;
  },

  insert: async (
    orgId: string,
    data: {
      source_type: SourceType;
      slug: string;
      name?: string | null;
      description?: string | null;
      status?: SourceStatus;
      device_type?: string | null;
      connection_type?: ConnectionType | null;
      credentials_encrypted?: string | null;
      ssh_credentials_encrypted?: string | null;
      config?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      last_seen_at?: string | null;
      last_connected_at?: string | null;
      last_error?: string | null;
    },
  ): Promise<Source[]> =>
    (await db
      .insert(sources)
      .values({
        ...data,
        org_id: orgId,
        config: data.config ?? {},
        metadata: data.metadata ?? {},
      } as typeof sources.$inferInsert)
      .returning()) as Source[],

  update: async (
    id: string,
    data: {
      name?: string | null;
      description?: string | null;
      status?: SourceStatus;
      device_type?: string | null;
      connection_type?: ConnectionType | null;
      credentials_encrypted?: string | null;
      config?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      last_seen_at?: string | null;
      last_connected_at?: string | null;
      last_error?: string | null;
    },
  ): Promise<Source[]> =>
    (await db
      .update(sources)
      .set(data as Partial<typeof sources.$inferInsert>)
      .where(eq(sources.id, id))
      .returning()) as Source[],

  updateLastSeen: async (id: string): Promise<Source[]> =>
    (await db
      .update(sources)
      .set({ last_seen_at: new Date().toISOString(), status: "online" })
      .where(eq(sources.id, id))
      .returning()) as Source[],

  updateLastConnected: async (
    id: string,
    config?: Record<string, unknown>,
  ): Promise<Source[]> => {
    const updateData: Record<string, unknown> = {
      last_connected_at: new Date().toISOString(),
      status: "online",
      last_error: null,
    };

    if (config) {
      // Get existing source to merge config
      const existing = await adminSourceQueries.findById(id);
      if (existing) {
        updateData.config = {
          ...(existing.config as Record<string, unknown>),
          ...config,
        };
      }
    }

    return (await db
      .update(sources)
      .set(updateData as Partial<typeof sources.$inferInsert>)
      .where(eq(sources.id, id))
      .returning()) as Source[];
  },

  setError: async (id: string, errorMessage: string): Promise<Source[]> =>
    (await db
      .update(sources)
      .set({ status: "error", last_error: errorMessage })
      .where(eq(sources.id, id))
      .returning()) as Source[],

  delete: async (id: string): Promise<void> => {
    await db.delete(sources).where(eq(sources.id, id));
  },

  /**
   * Find demo sources whose TTL has expired. A demo source is any source with
   * metadata.demo === true; it's considered expired when metadata.expires_at
   * (ISO string set by DemoSession) is in the past. Used by the demo TTL
   * sweeper cron to reap abandoned prospect demos.
   */
  findExpiredDemoSources: async (): Promise<Source[]> => {
    const nowIso = new Date().toISOString();
    // Only reap ephemeral (live-pitch) demos. Hosted prospect demos carry
    // metadata.ephemeral === false and must be torn down explicitly.
    return (await db
      .select()
      .from(sources)
      .where(
        and(
          sql`${sources.metadata}->>'demo' = 'true'`,
          sql`${sources.metadata}->>'ephemeral' = 'true'`,
          sql`${sources.metadata}->>'expires_at' < ${nowIso}`,
        ),
      )) as Source[];
  },

  /**
   * Find all connection sources across all orgs (for health check cron)
   * Only returns sources with encrypted credentials.
   */
  findAllConnections: async (): Promise<Source[]> =>
    (await db
      .select()
      .from(sources)
      .where(
        and(
          eq(sources.source_type, "connection"),
          isNotNull(sources.credentials_encrypted),
        ),
      )) as Source[],

  findAllRecording: async (): Promise<{ org_id: string; slug: string }[]> =>
    (await db
      .select({ org_id: sources.org_id, slug: sources.slug })
      .from(sources)
      .where(sql`${sources.config}->>'recording' = 'true'`)) as {
      org_id: string;
      slug: string;
    }[],
};

// =============================================================================
// ADMIN SOURCE LIMIT QUERIES (for gateway bootstrap - no user session)
// =============================================================================

export const adminSourceLimitQueries = {
  /**
   * Find all source_limits rows across all orgs with the source slug resolved
   * via inner JOIN. Used by the gateway bootstrap endpoint to hydrate its
   * in-memory rule store at startup.
   *
   * Resolves source_limits.source_id (UUID) → sources.slug so the gateway
   * can key rules by the same identifier that appears on the telemetry
   * stream envelopes. Orphaned limit rows (source deleted without cascade)
   * are dropped by the inner join.
   */
  findAllWithSlug: async (): Promise<
    Array<{
      id: string;
      org_id: string;
      metric: string;
      min: number | null;
      max: number | null;
      source_slug: string;
    }>
  > => {
    return db
      .select({
        id: sourceLimits.id,
        org_id: sourceLimits.org_id,
        metric: sourceLimits.metric,
        min: sourceLimits.min,
        max: sourceLimits.max,
        source_slug: sources.slug,
      })
      .from(sourceLimits)
      .innerJoin(sources, eq(sourceLimits.source_id, sources.id));
  },

  /**
   * Upsert a threshold monitor via the service role (bypasses RLS).
   * Needed when the request is authenticated via API key — there is no user
   * session, so the RLS WITH CHECK fails without the service role.
   * `source_id` must be the source UUID, not the slug.
   */
  upsert: async (
    orgId: string,
    sourceId: string,
    metric: string,
    data: {
      min?: number | null;
      max?: number | null;
      severity?: "info" | "warning" | "critical";
      message?: string | null;
      table_name?: string | null;
      time_column?: string | null;
    },
  ): Promise<void> => {
    await db
      .insert(sourceLimits)
      .values({
        org_id: orgId,
        source_id: sourceId,
        metric,
        min: data.min ?? null,
        max: data.max ?? null,
        severity: data.severity ?? "warning",
        message: data.message ?? null,
        table_name: data.table_name ?? null,
        time_column: data.time_column ?? null,
      } as typeof sourceLimits.$inferInsert)
      .onConflictDoUpdate({
        target: [
          sourceLimits.org_id,
          sourceLimits.source_id,
          sourceLimits.metric,
        ],
        set: {
          min: data.min ?? null,
          max: data.max ?? null,
          severity: data.severity ?? "warning",
          message: data.message ?? null,
          table_name: data.table_name ?? null,
          time_column: data.time_column ?? null,
          // Reconfigure ⇒ reset the poll cursor (init tick never alerts).
          poll_watermark: null,
        },
      });
  },

  /** Resolve a source slug to its UUID within an org. Admin client — no RLS. */
  resolveSlug: async (orgId: string, slug: string): Promise<string | null> => {
    const [row] = await db
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.org_id, orgId), eq(sources.slug, slug)))
      .limit(1);
    return row?.id ?? null;
  },

  /**
   * List source_limits for an org with the source slug + name joined in.
   * Admin (no RLS) equivalent of the user-scoped read in
   * `GET /api/monitors`. Needed because API-key callers have no session
   * JWT — without this, RLS silently returns zero rows for everything
   * the admin POST path wrote.
   */
  findByOrg: async (
    orgId: string,
  ): Promise<
    Array<{
      id: string;
      org_id: string;
      source_id: string;
      metric: string;
      min: number | null;
      max: number | null;
      severity: string;
      message: string | null;
      created_at: string;
      sources: { slug: string; name: string | null };
    }>
  > => {
    const rows = await db
      .select({
        id: sourceLimits.id,
        org_id: sourceLimits.org_id,
        source_id: sourceLimits.source_id,
        metric: sourceLimits.metric,
        min: sourceLimits.min,
        max: sourceLimits.max,
        severity: sourceLimits.severity,
        message: sourceLimits.message,
        created_at: sourceLimits.created_at,
        slug: sources.slug,
        name: sources.name,
      })
      .from(sourceLimits)
      .innerJoin(sources, eq(sourceLimits.source_id, sources.id))
      .where(eq(sourceLimits.org_id, orgId))
      .orderBy(desc(sourceLimits.created_at));
    return rows.map((r) => ({
      id: r.id,
      org_id: r.org_id,
      source_id: r.source_id,
      metric: r.metric,
      min: r.min,
      max: r.max,
      severity: r.severity,
      message: r.message,
      created_at: r.created_at,
      sources: { slug: r.slug, name: r.name },
    })) as Array<{
      id: string;
      org_id: string;
      source_id: string;
      metric: string;
      min: number | null;
      max: number | null;
      severity: string;
      message: string | null;
      created_at: string;
      sources: { slug: string; name: string | null };
    }>;
  },

  /** Admin (no RLS) delete — required for API-key DELETE /api/monitors. */
  delete: async (
    orgId: string,
    sourceId: string,
    metric: string,
  ): Promise<void> => {
    await db
      .delete(sourceLimits)
      .where(
        and(
          eq(sourceLimits.org_id, orgId),
          eq(sourceLimits.source_id, sourceId),
          eq(sourceLimits.metric, metric),
        ),
      );
  },
};

// =============================================================================
// ADMIN EVENT MONITOR QUERIES (for API key path — bypasses RLS)
// =============================================================================

export const adminEventMonitorQueries = {
  upsert: async (
    orgId: string,
    data: {
      source_id: string;
      metric: string;
      severity: "info" | "warning" | "critical";
      message?: string | null;
      enabled?: boolean;
      visualization?: unknown;
      notification_target_ids?: string[] | null;
      table_name?: string | null;
      time_column?: string | null;
      context_columns?: string[] | null;
      filters?: unknown;
      delivery?: string | null;
    },
  ): Promise<void> => {
    await db
      .insert(eventMonitors)
      .values({
        org_id: orgId,
        source_id: data.source_id,
        metric: data.metric,
        severity: data.severity,
        message: data.message ?? null,
        enabled: data.enabled ?? true,
        visualization: data.visualization ?? null,
        notification_target_ids: data.notification_target_ids ?? null,
        table_name: data.table_name ?? null,
        time_column: data.time_column ?? null,
        context_columns: data.context_columns ?? null,
        filters: data.filters ?? null,
        delivery: data.delivery ?? null,
      } as typeof eventMonitors.$inferInsert)
      .onConflictDoUpdate({
        target: [
          eventMonitors.org_id,
          eventMonitors.source_id,
          eventMonitors.metric,
        ],
        set: {
          severity: data.severity,
          message: data.message ?? null,
          enabled: data.enabled ?? true,
          visualization: data.visualization ?? null,
          // undefined = preserve existing routing on reconfigure; only an
          // explicit value (array or null) overwrites.
          ...(data.notification_target_ids !== undefined
            ? { notification_target_ids: data.notification_target_ids }
            : {}),
          table_name: data.table_name ?? null,
          time_column: data.time_column ?? null,
          context_columns: data.context_columns ?? null,
          filters: data.filters ?? null,
          delivery: data.delivery ?? null,
          // Reconfigure ⇒ reset the poll cursor (init tick never alerts).
          poll_watermark: null,
        },
      });
  },

  /**
   * Set notification targets without touching the rest of the monitor config
   * (unlike upsert, which resets the poll cursor). Returns rows updated.
   */
  setTargets: async (
    orgId: string,
    sourceId: string,
    metric: string,
    notificationTargetIds: string[] | null,
  ): Promise<number> => {
    const updated = await db
      .update(eventMonitors)
      .set({
        notification_target_ids: notificationTargetIds,
      } as Partial<typeof eventMonitors.$inferInsert>)
      .where(
        and(
          eq(eventMonitors.org_id, orgId),
          eq(eventMonitors.source_id, sourceId),
          eq(eventMonitors.metric, metric),
        ),
      )
      .returning({ id: eventMonitors.id });
    return updated.length;
  },

  /**
   * Admin (no RLS) list. Matches the shape returned by
   * `eventMonitorQueries.findByOrg` so the monitors route handler can
   * pick admin vs user query based on isApiKeyAuth.
   */
  findByOrg: async (orgId: string): Promise<EventMonitorRecord[]> => {
    return (await db
      .select()
      .from(eventMonitors)
      .where(eq(eventMonitors.org_id, orgId))) as EventMonitorRecord[];
  },

  /** Admin (no RLS) delete. */
  delete: async (
    orgId: string,
    sourceId: string,
    metric: string,
  ): Promise<void> => {
    await db
      .delete(eventMonitors)
      .where(
        and(
          eq(eventMonitors.org_id, orgId),
          eq(eventMonitors.source_id, sourceId),
          eq(eventMonitors.metric, metric),
        ),
      );
  },
};

// =============================================================================
// ADMIN ALERT RULE QUERIES (for alert-service bootstrap/push - no user session)
// =============================================================================

export interface AlertRuleWithSlug {
  id: string;
  org_id: string;
  source_id: string; // slug (TEXT), not UUID
  type: AlertRuleType;
  metric: string | null;
  conditions: Record<string, unknown>;
  operator: string | null;
  sub_rules: unknown[] | null;
  hysteresis_seconds: number | null;
  cooldown_seconds: number | null;
  severity: string;
}

export const adminAlertRuleQueries = {
  /**
   * Find all enabled alert_rules across all orgs. `source_id` IS the slug
   * (alert_rules stores slugs since 00037; legacy uuid rows rewritten in 0013)
   * — no join needed. Used by the alert-service bootstrap endpoint
   * (GET /api/internal/alerts/rules/all).
   */
  findAllEnabledWithSlug: async (): Promise<AlertRuleWithSlug[]> => {
    const rows = await db
      .select({
        id: alertRules.id,
        org_id: alertRules.org_id,
        source_id: alertRules.source_id,
        type: alertRules.type,
        metric: alertRules.metric,
        conditions: alertRules.conditions,
        operator: alertRules.operator,
        sub_rules: alertRules.sub_rules,
        hysteresis_seconds: alertRules.hysteresis_seconds,
        cooldown_seconds: alertRules.cooldown_seconds,
        severity: alertRules.severity,
      })
      .from(alertRules)
      .where(eq(alertRules.enabled, true));
    return rows.map((row) => ({
      id: row.id,
      org_id: row.org_id,
      source_id: row.source_id,
      type: row.type as AlertRuleType,
      metric: row.metric,
      conditions: (row.conditions ?? {}) as Record<string, unknown>,
      operator: row.operator,
      sub_rules: row.sub_rules as unknown[] | null,
      hysteresis_seconds: row.hysteresis_seconds,
      cooldown_seconds: row.cooldown_seconds,
      severity: row.severity,
    }));
  },

  /**
   * Find all enabled alert_rules for a single org. `source_id` IS the slug
   * (see findAllEnabledWithSlug). Used by the push helper after rule mutations.
   */
  findEnabledByOrgWithSlug: async (
    orgId: string,
  ): Promise<AlertRuleWithSlug[]> => {
    const rows = await db
      .select({
        id: alertRules.id,
        org_id: alertRules.org_id,
        source_id: alertRules.source_id,
        type: alertRules.type,
        metric: alertRules.metric,
        conditions: alertRules.conditions,
        operator: alertRules.operator,
        sub_rules: alertRules.sub_rules,
        hysteresis_seconds: alertRules.hysteresis_seconds,
        cooldown_seconds: alertRules.cooldown_seconds,
        severity: alertRules.severity,
      })
      .from(alertRules)
      .where(
        and(
          eq(alertRules.org_id, orgId),
          eq(alertRules.enabled, true),
          // Only the rule types the alert-service evaluates against the stream.
          // "offline" rules are absence-detection, evaluated by the frontend's
          // /api/internal/detect-offline scan — never send them to the alert-service.
          inArray(alertRules.type, ["threshold", "outlier", "compound"]),
        ),
      );
    return rows.map((row) => ({
      id: row.id,
      org_id: row.org_id,
      source_id: row.source_id,
      type: row.type as AlertRuleType,
      metric: row.metric,
      conditions: (row.conditions ?? {}) as Record<string, unknown>,
      operator: row.operator,
      sub_rules: row.sub_rules as unknown[] | null,
      hysteresis_seconds: row.hysteresis_seconds,
      cooldown_seconds: row.cooldown_seconds,
      severity: row.severity,
    }));
  },

  /** Offline ("stream stopped") rules for an org, with the source slug + name
   * joined in. These are metric-less, source-level monitors. */
  findOfflineByOrgWithSlug: async (
    orgId: string,
  ): Promise<
    Array<{
      id: string;
      source_id: string;
      slug: string;
      name: string | null;
      timeout_seconds: number;
      severity: string;
      enabled: boolean;
      notification_target_ids: string[] | null;
      created_at: string;
    }>
  > => {
    // alert_rules.source_id is the source SLUG (migration 00037 dropped the FK),
    // so we can't embed sources!inner — fetch rules, then resolve names by slug.
    const rows = await db
      .select({
        id: alertRules.id,
        source_id: alertRules.source_id,
        conditions: alertRules.conditions,
        severity: alertRules.severity,
        enabled: alertRules.enabled,
        notification_target_ids: alertRules.notification_target_ids,
        created_at: alertRules.created_at,
      })
      .from(alertRules)
      .where(and(eq(alertRules.org_id, orgId), eq(alertRules.type, "offline")));
    const slugs = [...new Set(rows.map((r) => r.source_id))];
    const nameBySlug = new Map<string, string | null>();
    if (slugs.length > 0) {
      const srcs = await db
        .select({ slug: sources.slug, name: sources.name })
        .from(sources)
        .where(and(eq(sources.org_id, orgId), inArray(sources.slug, slugs)));
      for (const s of srcs) {
        nameBySlug.set(s.slug, s.name);
      }
    }
    return rows.map((row) => {
      const slug = row.source_id;
      const cond = (row.conditions ?? {}) as { timeout_seconds?: number };
      return {
        id: row.id,
        source_id: slug,
        slug,
        name: nameBySlug.get(slug) ?? null,
        timeout_seconds: cond.timeout_seconds ?? 300,
        severity: row.severity ?? "warning",
        enabled: row.enabled,
        notification_target_ids: row.notification_target_ids,
        created_at: row.created_at,
      };
    });
  },

  /**
   * Threshold-rule notification targets for an org, keyed by (slug, metric).
   * Feeds GET /api/monitors, where threshold rows come from source_limits but
   * routing targets live on the alert_rules threshold row.
   */
  findThresholdTargetsByOrg: async (
    orgId: string,
  ): Promise<
    Array<{
      source_id: string; // slug
      metric: string | null;
      notification_target_ids: string[] | null;
    }>
  > => {
    return db
      .select({
        source_id: alertRules.source_id,
        metric: alertRules.metric,
        notification_target_ids: alertRules.notification_target_ids,
      })
      .from(alertRules)
      .where(
        and(eq(alertRules.org_id, orgId), eq(alertRules.type, "threshold")),
      );
  },

  /**
   * Set notification targets on the threshold rule for (slug, metric).
   * Returns rows updated (0 when no threshold rule exists).
   */
  setThresholdTargets: async (
    orgId: string,
    sourceSlug: string,
    metric: string,
    notificationTargetIds: string[] | null,
  ): Promise<number> => {
    const updated = await db
      .update(alertRules)
      .set({
        notification_target_ids: notificationTargetIds,
      } as Partial<typeof alertRules.$inferInsert>)
      .where(
        and(
          eq(alertRules.org_id, orgId),
          eq(alertRules.source_id, sourceSlug),
          eq(alertRules.metric, metric),
          eq(alertRules.type, "threshold"),
        ),
      )
      .returning({ id: alertRules.id });
    return updated.length;
  },

  /** The rule's source ref (alert_rules.source_id — a slug), for scope checks. */
  findSourceSlugById: async (
    orgId: string,
    id: string,
  ): Promise<string | null> => {
    const rows = await db
      .select({ source_id: alertRules.source_id })
      .from(alertRules)
      .where(and(eq(alertRules.org_id, orgId), eq(alertRules.id, id)))
      .limit(1);
    return rows[0]?.source_id ?? null;
  },

  /** Set notification targets on a rule by id (offline monitors). */
  setTargetsById: async (
    orgId: string,
    id: string,
    notificationTargetIds: string[] | null,
  ): Promise<number> => {
    const updated = await db
      .update(alertRules)
      .set({
        notification_target_ids: notificationTargetIds,
      } as Partial<typeof alertRules.$inferInsert>)
      .where(and(eq(alertRules.org_id, orgId), eq(alertRules.id, id)))
      .returning({ id: alertRules.id });
    return updated.length;
  },

  upsertThreshold: async (
    orgId: string,
    sourceSlug: string,
    metric: string,
    conditions: { min?: number | null; max?: number | null },
    severity: string,
    notificationTargetIds?: string[] | null,
  ): Promise<void> => {
    const conditionsJson = Object.fromEntries(
      Object.entries(conditions).filter(([, v]) => v != null),
    );
    const [existingRow] = await db
      .select({ id: alertRules.id })
      .from(alertRules)
      .where(
        and(
          eq(alertRules.org_id, orgId),
          eq(alertRules.source_id, sourceSlug),
          eq(alertRules.metric, metric),
          eq(alertRules.type, "threshold"),
        ),
      )
      .limit(1);
    if (existingRow) {
      await db
        .update(alertRules)
        .set({
          conditions: conditionsJson,
          severity,
          enabled: true,
          // undefined = preserve existing routing on reconfigure; only an
          // explicit value (array or null) overwrites.
          ...(notificationTargetIds !== undefined
            ? { notification_target_ids: notificationTargetIds }
            : {}),
        } as Partial<typeof alertRules.$inferInsert>)
        .where(eq(alertRules.id, existingRow.id));
    } else {
      await db.insert(alertRules).values({
        org_id: orgId,
        source_id: sourceSlug,
        metric,
        type: "threshold",
        conditions: conditionsJson,
        severity,
        enabled: true,
        notification_target_ids: notificationTargetIds ?? null,
      } as typeof alertRules.$inferInsert);
    }
  },

  deleteBySourceAndMetric: async (
    orgId: string,
    sourceSlug: string,
    metric: string,
  ): Promise<void> => {
    await db
      .delete(alertRules)
      .where(
        and(
          eq(alertRules.org_id, orgId),
          eq(alertRules.source_id, sourceSlug),
          eq(alertRules.metric, metric),
        ),
      );
  },

  /**
   * Delete a single alert rule by its id (org-scoped). Used to remove an offline
   * ("stream stopped") monitor unambiguously: its source_id is a slug that can be
   * UUID-shaped, so resolveRef/slug matching is unreliable — the rule id is not.
   * Runs on the admin client to mirror findOfflineByOrgWithSlug; a session-client
   * delete can silently match 0 rows under RLS. Returns rows deleted.
   */
  deleteById: async (orgId: string, id: string): Promise<number> => {
    const deleted = await db
      .delete(alertRules)
      .where(and(eq(alertRules.org_id, orgId), eq(alertRules.id, id)))
      .returning({ id: alertRules.id });
    return deleted.length;
  },

  /**
   * Delete offline ("stream stopped") rules for a source by slug (org-scoped).
   * Fallback for clients that don't send an explicit offline_id. Admin client so
   * it isn't silently no-op'd by RLS. Returns rows deleted.
   */
  deleteOfflineBySlug: async (
    orgId: string,
    sourceSlug: string,
  ): Promise<number> => {
    const deleted = await db
      .delete(alertRules)
      .where(
        and(
          eq(alertRules.org_id, orgId),
          eq(alertRules.source_id, sourceSlug),
          eq(alertRules.type, "offline"),
        ),
      )
      .returning({ id: alertRules.id });
    return deleted.length;
  },
};

// =============================================================================
// ADMIN DASHBOARD QUERIES (for server-side operations without user session)
// =============================================================================

export const adminDashboardQueries = {
  /**
   * Find all dashboards for an org (bypasses RLS)
   */
  findAll: async (orgId: string): Promise<Dashboard[]> => {
    return (await db
      .select()
      .from(dashboards)
      .where(eq(dashboards.org_id, orgId))
      .orderBy(desc(dashboards.updated_at))) as Dashboard[];
  },

  /**
   * Count dashboards for an org (bypasses RLS)
   */
  count: async (orgId: string): Promise<number> => {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(dashboards)
      .where(eq(dashboards.org_id, orgId));
    return count ?? 0;
  },

  /**
   * Insert a dashboard (bypasses RLS, for auto-generation from ingest)
   */
  insert: async (
    orgId: string,
    data: {
      name: string;
      description?: string | null;
      icon?: string | null;
      parent_id?: string | null;
      config: unknown;
    },
  ): Promise<Dashboard> => {
    const [result] = await db
      .insert(dashboards)
      .values({
        org_id: orgId,
        name: data.name,
        description: data.description ?? null,
        icon: data.icon ?? null,
        parent_id: data.parent_id ?? null,
        config: data.config,
      } as typeof dashboards.$inferInsert)
      .returning();
    return result as Dashboard;
  },

  /**
   * Check if a dashboard already exists for an org with a given name prefix
   */
  /**
   * Count AI-generated dashboards for an org (bypasses RLS)
   */
  countAiGenerated: async (orgId: string): Promise<number> => {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(dashboards)
      .where(
        and(
          eq(dashboards.org_id, orgId),
          like(dashboards.description, "%Auto-generated%"),
        ),
      );
    return count ?? 0;
  },

  /**
   * Find a dashboard by ID (bypasses RLS)
   */
  findById: async (orgId: string, id: string): Promise<Dashboard[]> => {
    return (await db
      .select()
      .from(dashboards)
      .where(
        and(eq(dashboards.org_id, orgId), eq(dashboards.id, id)),
      )) as Dashboard[];
  },

  /**
   * Update a dashboard (bypasses RLS)
   */
  update: async (
    orgId: string,
    id: string,
    updates: Record<string, unknown>,
  ): Promise<Dashboard[]> => {
    return (await db
      .update(dashboards)
      .set(updates as Partial<typeof dashboards.$inferInsert>)
      .where(and(eq(dashboards.org_id, orgId), eq(dashboards.id, id)))
      .returning()) as Dashboard[];
  },

  existsWithNamePrefix: async (
    orgId: string,
    namePrefix: string,
  ): Promise<boolean> => {
    const rows = await db
      .select({ id: dashboards.id })
      .from(dashboards)
      .where(
        and(
          eq(dashboards.org_id, orgId),
          ilike(dashboards.name, `${namePrefix}%`),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },

  deleteByName: async (orgId: string, name: string): Promise<number> => {
    const deleted = await db
      .delete(dashboards)
      .where(and(eq(dashboards.org_id, orgId), eq(dashboards.name, name)))
      .returning({ id: dashboards.id });
    return deleted.length;
  },

  /**
   * Delete a dashboard by ID (bypasses RLS). Used by API-key callers
   * on the DELETE /api/dashboards/[id] route so automated provisioning
   * pipelines can tear down try-session dashboards without requiring
   * a user session.
   */
  delete: async (orgId: string, id: string): Promise<number> => {
    const deleted = await db
      .delete(dashboards)
      .where(and(eq(dashboards.org_id, orgId), eq(dashboards.id, id)))
      .returning({ id: dashboards.id });
    return deleted.length;
  },

  /**
   * Update dashboard time range by name (for seed refresh)
   */
  updateTimeRangeByName: async (
    orgId: string,
    name: string,
    timeRange: { type: string; value: string },
  ): Promise<void> => {
    // First get the current config
    const rows = await db
      .select({ id: dashboards.id, config: dashboards.config })
      .from(dashboards)
      .where(and(eq(dashboards.org_id, orgId), eq(dashboards.name, name)))
      .limit(1);
    if (rows.length === 0) return;

    const dashboard = rows[0];
    const config = (dashboard.config || {}) as Record<string, unknown>;
    config.timeRange = timeRange;

    await db
      .update(dashboards)
      .set({ config } as Partial<typeof dashboards.$inferInsert>)
      .where(eq(dashboards.id, dashboard.id));
  },
};

// =============================================================================
// ADMIN DASHBOARD SHARE QUERIES (for public access without auth)
// =============================================================================

export const adminDashboardShareQueries = {
  /**
   * Find a share link by token (for public access validation)
   */
  findByToken: async (token: string): Promise<DashboardShareLink | null> => {
    const [row] = await db
      .select()
      .from(dashboardShareLinks)
      .where(eq(dashboardShareLinks.token, token))
      .limit(1);
    return (row ?? null) as DashboardShareLink | null;
  },

  /**
   * Get dashboard for a share link (for public view)
   */
  getDashboardForShareLink: async (
    shareLink: DashboardShareLink,
  ): Promise<Dashboard | null> => {
    const [row] = await db
      .select()
      .from(dashboards)
      .where(eq(dashboards.id, shareLink.dashboard_id))
      .limit(1);
    return (row ?? null) as Dashboard | null;
  },

  /**
   * Increment view count for a share link
   */
  incrementViewCount: async (token: string): Promise<void> => {
    // Atomic increment — avoids the read-modify-write race between concurrent
    // public views (the old PostgREST path read then wrote +1).
    await db
      .update(dashboardShareLinks)
      .set({ view_count: sql`${dashboardShareLinks.view_count} + 1` })
      .where(eq(dashboardShareLinks.token, token));
  },

  /**
   * Record a view for analytics
   */
  recordView: async (
    data: Omit<NewDashboardView, "id" | "created_at">,
  ): Promise<DashboardView> => {
    const [result] = await db
      .insert(dashboardViews)
      .values(data as typeof dashboardViews.$inferInsert)
      .returning();
    return result as DashboardView;
  },

  /**
   * Update a view (end session, add duration)
   */
  updateView: async (
    sessionId: string,
    data: {
      ended_at?: string;
      duration_seconds?: number;
      panels_viewed?: string[];
    },
  ): Promise<DashboardView | null> => {
    const [result] = await db
      .update(dashboardViews)
      .set(data as Partial<typeof dashboardViews.$inferInsert>)
      .where(eq(dashboardViews.session_id, sessionId))
      .returning();
    return (result ?? null) as DashboardView | null;
  },
};

// =============================================================================
// ADMIN ALERT QUERIES (for API key authenticated requests)
// =============================================================================

export const adminAlertQueries = {
  /**
   * Create a new alert (bypasses RLS for API key auth)
   */
  create: async (
    orgId: string,
    data: Omit<NewAlert, "org_id" | "id" | "created_at" | "updated_at">,
  ): Promise<Alert> => {
    const [result] = await db
      .insert(alerts)
      .values({
        org_id: orgId,
        ...data,
      } as typeof alerts.$inferInsert)
      .returning();
    return result as Alert;
  },

  /**
   * Find all alerts for an org
   */
  findAll: async (
    orgId: string,
    options?: {
      status?: string | string[];
      severity?: string | string[];
      sourceId?: string | string[];
      triggerType?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<Alert[]> => {
    const filters = [eq(alerts.org_id, orgId)];

    type AlertStatus = (typeof alerts.status.enumValues)[number];
    type AlertSeverity = (typeof alerts.severity.enumValues)[number];
    type AlertTrigger = (typeof alerts.trigger_type.enumValues)[number];

    if (options?.status) {
      const statuses = (
        Array.isArray(options.status) ? options.status : [options.status]
      ) as AlertStatus[];
      filters.push(inArray(alerts.status, statuses));
    }

    if (options?.severity) {
      const severities = (
        Array.isArray(options.severity) ? options.severity : [options.severity]
      ) as AlertSeverity[];
      filters.push(inArray(alerts.severity, severities));
    }

    if (options?.sourceId) {
      if (Array.isArray(options.sourceId)) {
        if (options.sourceId.length === 1) {
          filters.push(eq(alerts.source_id, options.sourceId[0]));
        } else if (options.sourceId.length > 1) {
          filters.push(inArray(alerts.source_id, options.sourceId));
        }
      } else {
        filters.push(eq(alerts.source_id, options.sourceId));
      }
    }

    if (options?.triggerType) {
      filters.push(
        eq(alerts.trigger_type, options.triggerType as AlertTrigger),
      );
    }

    let query = db
      .select()
      .from(alerts)
      .where(and(...filters))
      .orderBy(desc(alerts.triggered_at))
      .$dynamic();

    // Preserve the old PostgREST .range(offset, offset+(limit||50)-1) semantics:
    // an offset with no explicit limit still capped the page at 50 rows.
    if (options?.offset) {
      query = query.limit(options.limit ?? 50).offset(options.offset);
    } else if (options?.limit) {
      query = query.limit(options.limit);
    }

    return (await query) as Alert[];
  },

  /**
   * Get counts by status
   */
  getCountsByStatus: async (orgId: string): Promise<Record<string, number>> => {
    const rows = await db
      .select({
        status: alerts.status,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(alerts)
      .where(eq(alerts.org_id, orgId))
      .groupBy(alerts.status);

    const counts: Record<string, number> = {
      open: 0,
      acknowledged: 0,
      resolved: 0,
    };

    for (const row of rows) {
      counts[row.status] = (counts[row.status] || 0) + row.count;
    }

    return counts;
  },

  /**
   * Find alert by ID
   */
  findById: async (orgId: string, alertId: string): Promise<Alert | null> => {
    const [row] = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.org_id, orgId), eq(alerts.id, alertId)))
      .limit(1);
    return (row ?? null) as Alert | null;
  },

  /**
   * Update an alert (bypasses RLS for service-to-service operations)
   */
  update: async (
    orgId: string,
    alertId: string,
    data: Record<string, unknown>,
  ): Promise<Alert | null> => {
    const [result] = await db
      .update(alerts)
      .set(data as Partial<typeof alerts.$inferInsert>)
      .where(and(eq(alerts.org_id, orgId), eq(alerts.id, alertId)))
      .returning();
    return (result ?? null) as Alert | null;
  },

  /**
   * Recency-windowed verdict rollup for a rule/limit on a source. Service-role
   * mirror of alertQueries.getVerdictStats (for API-key reads of an alert).
   */
  getVerdictStats: async (
    orgId: string,
    by: {
      ruleId?: string | null;
      limitId?: string | null;
      sourceId?: string | null;
      eventMetric?: string | null;
    },
  ): Promise<VerdictStats> => {
    const empty: VerdictStats = { helpful: 0, noise: 0, total: 0 };
    const isEvent = !by.ruleId && !by.limitId && !!by.eventMetric;
    if (!by.ruleId && !by.limitId && !isEvent) return empty;
    if (isEvent && !by.sourceId) return empty;
    const since = new Date(
      Date.now() - VERDICT_WINDOW_DAYS * 86_400_000,
    ).toISOString();
    const filters = [
      eq(alerts.org_id, orgId),
      isNotNull(alerts.current_verdict),
      gte(alerts.triggered_at, since),
      by.ruleId
        ? eq(alerts.rule_id, by.ruleId)
        : by.limitId
          ? eq(alerts.limit_id, by.limitId)
          : and(
              eq(alerts.trigger_type, "event"),
              eq(alerts.metric, by.eventMetric as string),
            )!,
    ];
    if (by.sourceId) filters.push(eq(alerts.source_id, by.sourceId));

    const rows = await db
      .select({ current_verdict: alerts.current_verdict })
      .from(alerts)
      .where(and(...filters))
      .orderBy(desc(alerts.triggered_at))
      .limit(VERDICT_SAMPLE);
    return tallyVerdicts(rows);
  },

  /** Open-alert count per source (admin/no-RLS). Mirrors
   * alertQueries.getOpenCountsBySource for the API-key fleet-overview path. */
  getOpenCountsBySource: async (
    orgId: string,
  ): Promise<Array<{ source_id: string; count: number }>> => {
    const rows = await db
      .select({
        source_id: alerts.source_id,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(alerts)
      .where(and(eq(alerts.org_id, orgId), eq(alerts.status, "open")))
      .groupBy(alerts.source_id);
    return rows
      .filter((r): r is { source_id: string; count: number } => !!r.source_id)
      .map((r) => ({ source_id: r.source_id, count: r.count }));
  },

  /** Verdict tally per source over the recency window (admin/no-RLS). Mirrors
   * alertQueries.getNoiseBySource. */
  getNoiseBySource: async (
    orgId: string,
  ): Promise<Array<{ source_id: string; noise: number; total: number }>> => {
    const since = new Date(
      Date.now() - VERDICT_WINDOW_DAYS * 86_400_000,
    ).toISOString();
    const rows = await db
      .select({
        source_id: alerts.source_id,
        noise: sql<number>`count(*) filter (where ${alerts.current_verdict} = 'noise')`.mapWith(
          Number,
        ),
        total: sql<number>`count(*)`.mapWith(Number),
      })
      .from(alerts)
      .where(
        and(
          eq(alerts.org_id, orgId),
          isNotNull(alerts.current_verdict),
          gte(alerts.triggered_at, since),
        ),
      )
      .groupBy(alerts.source_id);
    return rows
      .filter(
        (r): r is { source_id: string; noise: number; total: number } =>
          !!r.source_id,
      )
      .map((r) => ({ source_id: r.source_id, noise: r.noise, total: r.total }));
  },

  /**
   * Find the open alert for a given (rule, source) pair.
   * Used by the transitions endpoint for close-matching.
   */
  findOpenByRuleAndSource: async (
    orgId: string,
    ruleId: string,
    sourceId: string,
  ): Promise<Alert | null> => {
    const [row] = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.org_id, orgId),
          eq(alerts.rule_id, ruleId),
          eq(alerts.source_id, sourceId),
          eq(alerts.is_alert_active, true),
        ),
      )
      .limit(1);
    return (row ?? null) as Alert | null;
  },

  /**
   * Delete an alert (bypasses RLS for admin operations)
   */
  delete: async (orgId: string, alertId: string): Promise<boolean> => {
    await db
      .delete(alerts)
      .where(and(eq(alerts.org_id, orgId), eq(alerts.id, alertId)));
    return true;
  },
};

// =============================================================================
// ADMIN ALERT EVENT QUERIES (for API key authenticated requests)
// =============================================================================

export const adminAlertEventQueries = {
  /**
   * Create an alert event (bypasses RLS for API key auth)
   */
  create: async (
    orgId: string,
    alertId: string,
    eventType: AlertEventType,
    options?: {
      actorId?: string;
      message?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<AlertEvent> => {
    const [result] = await db
      .insert(alertEvents)
      .values({
        org_id: orgId,
        alert_id: alertId,
        event_type: eventType,
        actor_id: options?.actorId || null,
        message: options?.message || null,
        metadata: options?.metadata || {},
      } as typeof alertEvents.$inferInsert)
      .returning();
    return result as AlertEvent;
  },

  /**
   * Find all events for an alert (bypasses RLS for API key auth).
   * Mirrors alertEventQueries.findByAlert.
   */
  findByAlert: async (
    orgId: string,
    alertId: string,
  ): Promise<AlertEvent[]> => {
    return (await db
      .select()
      .from(alertEvents)
      .where(
        and(eq(alertEvents.org_id, orgId), eq(alertEvents.alert_id, alertId)),
      )
      .orderBy(asc(alertEvents.created_at))) as AlertEvent[];
  },
};

// =============================================================================
// ADMIN SOURCE CONTEXT QUERIES (for API key authenticated requests)
// =============================================================================

export const adminSourceContextQueries = {
  /**
   * Find all context items for a source (bypasses RLS)
   * This is critical for RCA - it contains the actual documentation
   */
  findBySource: async (
    orgId: string,
    sourceId: string,
  ): Promise<SourceContext[]> => {
    return (await db
      .select()
      .from(sourceContext)
      .where(
        and(
          eq(sourceContext.org_id, orgId),
          eq(sourceContext.source_id, sourceId),
        ),
      )
      .orderBy(desc(sourceContext.created_at))) as SourceContext[];
  },
};

// =============================================================================
// ADMIN DEVICE SCHEMA QUERIES (for ingest pipeline - API key auth)
// =============================================================================

export const adminDeviceSchemaQueries = {
  /**
   * Find all schemas for a source (bypasses RLS)
   */
  findBySource: async (
    orgId: string,
    sourceSlug: string,
  ): Promise<DeviceSchemaRecord[]> => {
    return (await db
      .select()
      .from(deviceSchemas)
      .where(
        and(
          eq(deviceSchemas.org_id, orgId),
          eq(deviceSchemas.source_id, sourceSlug),
        ),
      )
      .orderBy(asc(deviceSchemas.metric))) as DeviceSchemaRecord[];
  },

  /**
   * Batch upsert metrics for a source.
   * Uses atomic Postgres function to avoid race conditions between
   * concurrent serverless invocations (ON CONFLICT DO UPDATE with
   * server-side LEAST/GREATEST aggregation).
   */
  upsertBatch: async (
    orgId: string,
    sourceSlug: string,
    metrics: Array<{
      metric: string;
      value_type: string;
      sample_count: number;
      min_value: number | null;
      max_value: number | null;
    }>,
  ): Promise<void> => {
    if (metrics.length === 0) return;

    // upsert_device_schemas (see migration 0001_functions_triggers.sql) does the
    // atomic ON CONFLICT DO UPDATE with server-side LEAST/GREATEST aggregation,
    // so concurrent ingest invocations can't clobber each other's min/max.
    const payload = metrics.map((m) => ({
      metric: m.metric,
      value_type: m.value_type,
      sample_count: m.sample_count,
      min_value: m.min_value,
      max_value: m.max_value,
    }));
    await db.execute(
      sql`select upsert_device_schemas(${orgId}, ${sourceSlug}, ${JSON.stringify(payload)}::jsonb)`,
    );
  },

  /**
   * Count schemas for a source (for classification threshold)
   */
  countBySource: async (orgId: string, sourceSlug: string): Promise<number> => {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(deviceSchemas)
      .where(
        and(
          eq(deviceSchemas.org_id, orgId),
          eq(deviceSchemas.source_id, sourceSlug),
        ),
      );
    return count ?? 0;
  },
};

// =============================================================================
// ADMIN ORG BILLING QUERIES
// =============================================================================

/**
 * Insert-or-update a partial org_billing row. Only the columns in `update`
 * are written on conflict — everything else keeps its current value (or the
 * DB column default on first insert). Every org_billing write goes through
 * this so a write can never silently no-op against a missing row (orgs that
 * predate the table, or whose creation webhook was missed).
 */
async function upsertOrgBilling(
  orgId: string,
  update: OrgBillingUpdate,
): Promise<void> {
  await db
    .insert(orgBilling)
    .values({ ...update, org_id: orgId } as typeof orgBilling.$inferInsert)
    .onConflictDoUpdate({
      target: orgBilling.org_id,
      // Only the provided columns are written on conflict; if `update` is empty
      // this is a no-op self-set that still guarantees the row exists.
      set: (Object.keys(update).length ? update : { org_id: orgId }) as Partial<
        typeof orgBilling.$inferInsert
      >,
    });
}

export const adminOrgBillingQueries = {
  findByOrgId: async (orgId: string): Promise<OrgBillingRow | null> => {
    const rows = await db
      .select()
      .from(orgBilling)
      .where(eq(orgBilling.org_id, orgId))
      .limit(1);
    return (rows[0] ?? null) as OrgBillingRow | null;
  },

  findAll: async (): Promise<OrgBillingRow[]> =>
    (await db.select().from(orgBilling)) as OrgBillingRow[],

  upsert: upsertOrgBilling,

  /** Alias of upsert — kept for call-site readability ("patch one field"). */
  patch: upsertOrgBilling,
};
