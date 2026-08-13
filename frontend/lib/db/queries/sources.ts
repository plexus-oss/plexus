import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  like,
  or,
  sql,
} from "drizzle-orm";

import { db } from "../client";
import {
  sources,
  sourceAssociations,
  sourceContext,
  sourceLimits,
  sourceGroups,
  sourcePermissions,
  eventMonitors,
  deviceSchemas,
  columnMetadata,
} from "../schema";
import { createOrgQueries } from "./shared";
import type {
  Source,
  NewSource,
  SourceType,
  SourceStatus,
  SourceContext,
  NewSourceContext,
  SourceContextType,
  SourceLimitRecord,
  LimitSeverity,
  SourceGroup,
  NewSourceGroup,
  SourceGroupFilterCriteria,
  SourceGroupWithMembers,
  SourcePermission,
  ShareLinkAccess,
  EventMonitorRecord,
  EventMonitorFilter,
  EventMonitorDelivery,
  DeviceSchemaRecord,
  ColumnMetadataRecord,
  SourceAssociation,
} from "../types";

// =============================================================================
// SOURCE QUERIES
// =============================================================================

export const sourceQueries = {
  ...createOrgQueries<Source, NewSource>(sources),

  findBySlug: async (orgId: string, slug: string): Promise<Source[]> => {
    return (await db
      .select()
      .from(sources)
      .where(
        and(eq(sources.org_id, orgId), eq(sources.slug, slug)),
      )) as Source[];
  },

  /** Batch slug lookup — used by the telemetry access filter. */
  findBySlugs: async (orgId: string, slugs: string[]): Promise<Source[]> => {
    if (slugs.length === 0) return [];
    return (await db
      .select()
      .from(sources)
      .where(
        and(eq(sources.org_id, orgId), inArray(sources.slug, slugs)),
      )) as Source[];
  },

  /** Batch id lookup — payload identity enrichment (source_slug/source_name). */
  findByIds: async (orgId: string, ids: string[]): Promise<Source[]> => {
    if (ids.length === 0) return [];
    return (await db
      .select()
      .from(sources)
      .where(
        and(eq(sources.org_id, orgId), inArray(sources.id, ids)),
      )) as Source[];
  },

  findByDeviceType: async (
    orgId: string,
    deviceType: string,
  ): Promise<Source[]> => {
    return (await db
      .select()
      .from(sources)
      .where(
        and(
          eq(sources.org_id, orgId),
          eq(sources.source_type, "device"),
          eq(sources.device_type, deviceType),
        ),
      )
      .orderBy(asc(sources.name))) as Source[];
  },

  findByType: async (
    orgId: string,
    sourceType: SourceType | SourceType[],
  ): Promise<Source[]> => {
    const types = Array.isArray(sourceType) ? sourceType : [sourceType];
    return (await db
      .select()
      .from(sources)
      .where(
        and(eq(sources.org_id, orgId), inArray(sources.source_type, types)),
      )
      .orderBy(desc(sources.created_at))) as Source[];
  },

  findByStatus: async (
    orgId: string,
    status: SourceStatus | SourceStatus[],
  ): Promise<Source[]> => {
    const statuses = Array.isArray(status) ? status : [status];
    return (await db
      .select()
      .from(sources)
      .where(and(eq(sources.org_id, orgId), inArray(sources.status, statuses)))
      .orderBy(desc(sources.created_at))) as Source[];
  },

  findAllFiltered: async (
    orgId: string,
    filters?: {
      type?: SourceType | SourceType[];
      status?: SourceStatus | SourceStatus[];
      search?: string;
    },
  ): Promise<Source[]> => {
    // Page through in chunks so orgs with large satellite catalogs return every
    // row to render the earth panel; stop when a page comes back short.
    const PAGE = 1000;
    const out: Source[] = [];
    for (let from = 0; ; from += PAGE) {
      const conds = [eq(sources.org_id, orgId)];

      if (filters?.type) {
        const types = Array.isArray(filters.type)
          ? filters.type
          : [filters.type];
        conds.push(inArray(sources.source_type, types));
      }

      if (filters?.status) {
        const statuses = Array.isArray(filters.status)
          ? filters.status
          : [filters.status];
        conds.push(inArray(sources.status, statuses));
      }

      if (filters?.search) {
        // Parameterized OR over slug/name — no string-concatenated values.
        conds.push(
          or(
            ilike(sources.slug, `%${filters.search}%`),
            ilike(sources.name, `%${filters.search}%`),
          )!,
        );
      }

      const page = (await db
        .select()
        .from(sources)
        .where(and(...conds))
        .orderBy(desc(sources.created_at))
        .limit(PAGE)
        .offset(from)) as Source[];

      out.push(...page);
      if (page.length < PAGE) break;
    }
    return out;
  },

  updateStatus: async (
    orgId: string,
    id: string,
    status: SourceStatus,
    error?: string | null,
  ): Promise<Source[]> => {
    const updateData: Record<string, unknown> = { status };

    if (status === "online") {
      updateData.last_seen_at = new Date().toISOString();
      updateData.last_error = null;
    } else if (status === "error" && error) {
      updateData.last_error = error;
    }

    return (await db
      .update(sources)
      .set(updateData as Partial<typeof sources.$inferInsert>)
      .where(and(eq(sources.org_id, orgId), eq(sources.id, id)))
      .returning()) as Source[];
  },

  updateLastSeen: async (orgId: string, id: string): Promise<Source[]> => {
    return (await db
      .update(sources)
      .set({
        last_seen_at: new Date().toISOString(),
        status: "online",
      } as Partial<typeof sources.$inferInsert>)
      .where(and(eq(sources.org_id, orgId), eq(sources.id, id)))
      .returning()) as Source[];
  },

  updateLastConnected: async (
    orgId: string,
    id: string,
    config?: Record<string, unknown>,
  ): Promise<Source[]> => {
    const updateData: Record<string, unknown> = {
      last_connected_at: new Date().toISOString(),
      status: "online",
      last_error: null,
    };

    if (config) {
      const existing = await sourceQueries.findById(orgId, id);
      if (existing.length > 0) {
        updateData.config = {
          ...(existing[0].config as Record<string, unknown>),
          ...config,
        };
      }
    }

    return (await db
      .update(sources)
      .set(updateData as Partial<typeof sources.$inferInsert>)
      .where(and(eq(sources.org_id, orgId), eq(sources.id, id)))
      .returning()) as Source[];
  },

  count: async (orgId: string): Promise<number> => {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(sources)
      .where(eq(sources.org_id, orgId));
    return count ?? 0;
  },

  /** Batch update metadata fields on source rows (e.g. TLE data for satellites) */
  updateMetadataBatch: async (
    orgId: string,
    updates: Array<{
      id: string;
      tle_line1: string;
      tle_line2: string;
      tle_epoch: string;
      official_name?: string;
      tle_source?: "celestrak" | "connection";
    }>,
  ): Promise<void> => {
    if (updates.length === 0) return;
    const now = new Date().toISOString();

    const values = sql.join(
      updates.map(
        (u) =>
          sql`(${u.id}::uuid, ${u.tle_line1}::text, ${u.tle_line2}::text, ${u.tle_epoch}::text, ${u.official_name ?? null}::text, ${u.tle_source ?? null}::text)`,
      ),
      sql`,`,
    );

    await db.execute(sql`
      UPDATE sources
      SET metadata = COALESCE(sources.metadata, '{}'::jsonb) || jsonb_build_object(
        'tle_line1', t.tle_line1,
        'tle_line2', t.tle_line2,
        'tle_epoch', t.tle_epoch,
        'tle_fetched_at', ${now}::text,
        'official_name', t.official_name,
        'tle_source', t.tle_source
      ),
      name = COALESCE(t.official_name, sources.name)
      FROM (VALUES ${values}) AS t(id, tle_line1, tle_line2, tle_epoch, official_name, tle_source)
      WHERE sources.id = t.id AND sources.org_id = ${orgId}
    `);
  },

  countByType: async (orgId: string): Promise<Record<SourceType, number>> => {
    const rows = await db
      .select({
        source_type: sources.source_type,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(sources)
      .where(eq(sources.org_id, orgId))
      .groupBy(sources.source_type);

    const counts: Record<SourceType, number> = {
      device: 0,
      connection: 0,
    };

    for (const row of rows) {
      const type = row.source_type as SourceType;
      if (type in counts) {
        counts[type] = row.count;
      }
    }

    return counts;
  },
};

// =============================================================================
// SOURCE CONTEXT QUERIES
// =============================================================================

export const sourceContextQueries = {
  ...createOrgQueries<SourceContext, NewSourceContext>(sourceContext),

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

  findBySourceAndType: async (
    orgId: string,
    sourceId: string,
    contextType: SourceContextType,
  ): Promise<SourceContext[]> => {
    return (await db
      .select()
      .from(sourceContext)
      .where(
        and(
          eq(sourceContext.org_id, orgId),
          eq(sourceContext.source_id, sourceId),
          eq(sourceContext.context_type, contextType),
        ),
      )
      .orderBy(desc(sourceContext.created_at))) as SourceContext[];
  },

  /**
   * Note items with a given name across ALL of an org's sources, joined to
   * their source for display + linking. Used by /api/intelligence to list
   * "Model memory" notes (the facts the labeling model asked to remember).
   */
  findNotesByName: async (
    orgId: string,
    name: string,
  ): Promise<
    Array<{
      id: string;
      source_id: string;
      name: string;
      content: string | null;
      created_at: string | null;
      source_slug: string;
      source_name: string | null;
      source_type: string;
    }>
  > => {
    return await db
      .select({
        id: sourceContext.id,
        source_id: sourceContext.source_id,
        name: sourceContext.name,
        content: sourceContext.content,
        created_at: sourceContext.created_at,
        source_slug: sources.slug,
        source_name: sources.name,
        source_type: sources.source_type,
      })
      .from(sourceContext)
      .innerJoin(sources, eq(sourceContext.source_id, sources.id))
      .where(
        and(
          eq(sourceContext.org_id, orgId),
          eq(sourceContext.context_type, "note"),
          eq(sourceContext.name, name),
        ),
      )
      .orderBy(desc(sourceContext.created_at));
  },
};

// =============================================================================
// SOURCE LIMIT QUERIES
// =============================================================================

export const sourceLimitQueries = {
  findBySource: async (
    orgId: string,
    sourceId: string,
  ): Promise<SourceLimitRecord[]> => {
    return (await db
      .select()
      .from(sourceLimits)
      .where(
        and(
          eq(sourceLimits.org_id, orgId),
          eq(sourceLimits.source_id, sourceId),
        ),
      )) as SourceLimitRecord[];
  },

  findBySourceAndMetric: async (
    orgId: string,
    sourceId: string,
    metric: string,
  ): Promise<SourceLimitRecord[]> => {
    return (await db
      .select()
      .from(sourceLimits)
      .where(
        and(
          eq(sourceLimits.org_id, orgId),
          eq(sourceLimits.source_id, sourceId),
          eq(sourceLimits.metric, metric),
        ),
      )) as SourceLimitRecord[];
  },

  upsert: async (
    orgId: string,
    sourceId: string,
    metric: string,
    data: {
      min?: number | null;
      max?: number | null;
      severity?: LimitSeverity;
      message?: string | null;
      table_name?: string | null;
      time_column?: string | null;
    },
  ): Promise<SourceLimitRecord[]> => {
    const severity = (data.severity ??
      "warning") as (typeof sourceLimits.severity.enumValues)[number];
    return (await db
      .insert(sourceLimits)
      .values({
        org_id: orgId,
        source_id: sourceId,
        metric,
        min: data.min ?? null,
        max: data.max ?? null,
        severity,
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
          severity,
          message: data.message ?? null,
          table_name: data.table_name ?? null,
          time_column: data.time_column ?? null,
          // Reconfigure ⇒ reset the poll cursor (init tick never alerts).
          poll_watermark: null,
        },
      })
      .returning()) as SourceLimitRecord[];
  },

  /** Poll-loop state writer — same contract as eventMonitorQueries.updatePollState. */
  updatePollState: async (
    orgId: string,
    id: string,
    data: {
      poll_watermark?: string | null;
      last_polled_at?: string;
      table_name?: string | null;
      time_column?: string | null;
      last_status?: string | null;
      last_error?: string | null;
      last_evaluated_at?: string;
    },
  ): Promise<void> => {
    await db
      .update(sourceLimits)
      .set(data as Partial<typeof sourceLimits.$inferInsert>)
      .where(and(eq(sourceLimits.org_id, orgId), eq(sourceLimits.id, id)));
  },

  delete: async (
    orgId: string,
    sourceId: string,
    metric: string,
  ): Promise<SourceLimitRecord[]> => {
    return (await db
      .delete(sourceLimits)
      .where(
        and(
          eq(sourceLimits.org_id, orgId),
          eq(sourceLimits.source_id, sourceId),
          eq(sourceLimits.metric, metric),
        ),
      )
      .returning()) as SourceLimitRecord[];
  },

  deleteAllForSource: async (
    orgId: string,
    sourceId: string,
  ): Promise<SourceLimitRecord[]> => {
    return (await db
      .delete(sourceLimits)
      .where(
        and(
          eq(sourceLimits.org_id, orgId),
          eq(sourceLimits.source_id, sourceId),
        ),
      )
      .returning()) as SourceLimitRecord[];
  },

  // findByOrgWithSlug resolves source_limits.source_id (UUID) → sources.slug via
  // an inner JOIN, so callers can push rules to the gateway using the slug that
  // actually appears on the telemetry stream. Orphaned limit rows (source
  // deleted without cascade) are dropped by the inner join.
  findByOrgWithSlug: async (
    orgId: string,
  ): Promise<
    Array<{
      id: string;
      metric: string;
      min: number | null;
      max: number | null;
      source_slug: string;
    }>
  > => {
    const rows = await db
      .select({
        id: sourceLimits.id,
        metric: sourceLimits.metric,
        min: sourceLimits.min,
        max: sourceLimits.max,
        source_slug: sources.slug,
      })
      .from(sourceLimits)
      .innerJoin(sources, eq(sourceLimits.source_id, sources.id))
      .where(eq(sourceLimits.org_id, orgId));
    return rows.map((row) => ({
      id: row.id,
      metric: row.metric,
      min: row.min,
      max: row.max,
      source_slug: row.source_slug,
    }));
  },

  countBySourceSlugPrefix: async (
    orgId: string,
    prefix: string,
  ): Promise<number> => {
    const srcRows = await db
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.org_id, orgId), like(sources.slug, `${prefix}%`)));

    if (srcRows.length === 0) return 0;

    const sourceIds = srcRows.map((s) => s.id);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(sourceLimits)
      .where(
        and(
          eq(sourceLimits.org_id, orgId),
          inArray(sourceLimits.source_id, sourceIds),
        ),
      );
    return count ?? 0;
  },
};

// =============================================================================
// SOURCE GROUP QUERIES
// =============================================================================

export const sourceGroupQueries = {
  ...createOrgQueries<SourceGroup, NewSourceGroup>(sourceGroups),

  findWithMembers: async (
    orgId: string,
    groupId: string,
  ): Promise<SourceGroupWithMembers | null> => {
    const groups = await sourceGroupQueries.findById(orgId, groupId);
    if (groups.length === 0) return null;

    const group = groups[0];
    const members = await sourceGroupQueries.computeMembers(orgId, group);

    return {
      ...group,
      members,
      memberCount: members.length,
    };
  },

  computeMembers: async (
    orgId: string,
    group: SourceGroup,
  ): Promise<Source[]> => {
    const criteria = group.filter_criteria as SourceGroupFilterCriteria;
    const staticIds = group.static_member_ids || [];

    const sourceTypes = (group as SourceGroup).source_types || ["device"];

    const conds = [
      eq(sources.org_id, orgId),
      inArray(sources.source_type, sourceTypes),
    ];

    if (criteria.deviceTypes && criteria.deviceTypes.length > 0) {
      conds.push(inArray(sources.device_type, criteria.deviceTypes));
    }

    if (criteria.statuses && criteria.statuses.length > 0) {
      conds.push(inArray(sources.status, criteria.statuses));
    }

    if (criteria.healthScoreMin !== undefined) {
      conds.push(gte(sources.health_score, criteria.healthScoreMin));
    }

    if (criteria.healthScoreMax !== undefined) {
      conds.push(lte(sources.health_score, criteria.healthScoreMax));
    }

    if (criteria.namePattern) {
      conds.push(ilike(sources.name, `%${criteria.namePattern}%`));
    }

    if (criteria.slugPattern) {
      conds.push(ilike(sources.slug, `%${criteria.slugPattern}%`));
    }

    const filteredSources = (await db
      .select()
      .from(sources)
      .where(and(...conds))) as Source[];

    let members = filteredSources;

    if (criteria.tags && criteria.tags.length > 0) {
      members = members.filter((source) => {
        const sourceTags = (source as Source & { tags?: string[] }).tags || [];
        return criteria.tags!.every((tag) => sourceTags.includes(tag));
      });
    }

    if (staticIds.length > 0) {
      const memberIds = new Set(members.map((m) => m.id));
      const missingIds = staticIds.filter((id) => !memberIds.has(id));

      if (missingIds.length > 0) {
        const staticMembers = (await db
          .select()
          .from(sources)
          .where(
            and(eq(sources.org_id, orgId), inArray(sources.id, missingIds)),
          )) as Source[];
        members = [...members, ...staticMembers];
      }
    }

    return members;
  },

  findAllWithCounts: async (
    orgId: string,
  ): Promise<(SourceGroup & { memberCount: number })[]> => {
    const groups = await sourceGroupQueries.findAll(orgId);
    const membersPerGroup = await Promise.all(
      groups.map((g) => sourceGroupQueries.computeMembers(orgId, g)),
    );
    return groups.map((g, i) => ({
      ...g,
      memberCount: membersPerGroup[i].length,
    }));
  },
};

// =============================================================================
// SOURCE ASSOCIATION QUERIES (entity discovery — the slice predicate)
// =============================================================================
// A row = "entity E's data lives in connection C's table T where
// filter_column = filter_value". Written by the discovery loop; read by the
// detail page Data tab, linked-devices lists, and the monitor poller.

export const sourceAssociationQueries = {
  upsert: async (
    orgId: string,
    data: {
      entity_type: "device" | "satellite";
      entity_id: string;
      connection_id: string;
      table_name: string;
      table_schema?: string | null;
      filter_column: string;
      filter_value: string;
      label?: string | null;
    },
  ): Promise<SourceAssociation> => {
    const rows = await db
      .insert(sourceAssociations)
      .values({ org_id: orgId, ...data })
      .onConflictDoUpdate({
        target: [
          sourceAssociations.org_id,
          sourceAssociations.entity_id,
          sourceAssociations.connection_id,
          sourceAssociations.table_name,
        ],
        set: {
          filter_column: data.filter_column,
          filter_value: data.filter_value,
          table_schema: data.table_schema ?? null,
          label: data.label ?? null,
          updated_at: sql`now()`,
        },
      })
      .returning();
    return rows[0] as SourceAssociation;
  },

  findByEntity: async (
    orgId: string,
    entityId: string,
  ): Promise<SourceAssociation[]> =>
    (await db
      .select()
      .from(sourceAssociations)
      .where(
        and(
          eq(sourceAssociations.org_id, orgId),
          eq(sourceAssociations.entity_id, entityId),
        ),
      )) as SourceAssociation[],

  findByConnection: async (
    orgId: string,
    connectionId: string,
  ): Promise<SourceAssociation[]> =>
    (await db
      .select()
      .from(sourceAssociations)
      .where(
        and(
          eq(sourceAssociations.org_id, orgId),
          eq(sourceAssociations.connection_id, connectionId),
        ),
      )) as SourceAssociation[],

  /**
   * Distinct connection ids any of these entities slice — powers
   * "a connection is visible (row-filtered) when the viewer's scope holds an
   * associated entity" in lib/access.
   */
  findConnectionIdsForEntities: async (
    orgId: string,
    entityIds: string[],
  ): Promise<Set<string>> => {
    if (entityIds.length === 0) return new Set();
    const rows = await db
      .select({ connection_id: sourceAssociations.connection_id })
      .from(sourceAssociations)
      .where(
        and(
          eq(sourceAssociations.org_id, orgId),
          inArray(sourceAssociations.entity_id, entityIds),
        ),
      );
    return new Set(rows.map((r) => r.connection_id));
  },

  /** Source deletion hook — associations have no FK on entity_id. */
  deleteByEntity: async (orgId: string, entityId: string): Promise<void> => {
    await db
      .delete(sourceAssociations)
      .where(
        and(
          eq(sourceAssociations.org_id, orgId),
          eq(sourceAssociations.entity_id, entityId),
        ),
      );
  },
};

// =============================================================================
// SOURCE PERMISSION QUERIES (RBAC Phase 3 — device + fleet grants)
// =============================================================================

export const sourcePermissionQueries = {
  findBySource: async (
    orgId: string,
    sourceId: string,
  ): Promise<SourcePermission[]> => {
    return (await db
      .select()
      .from(sourcePermissions)
      .where(
        and(
          eq(sourcePermissions.org_id, orgId),
          eq(sourcePermissions.source_id, sourceId),
        ),
      )) as SourcePermission[];
  },

  findBySourceGroup: async (
    orgId: string,
    sourceGroupId: string,
  ): Promise<SourcePermission[]> => {
    return (await db
      .select()
      .from(sourcePermissions)
      .where(
        and(
          eq(sourcePermissions.org_id, orgId),
          eq(sourcePermissions.source_group_id, sourceGroupId),
        ),
      )) as SourcePermission[];
  },

  /** Grant access. Exactly one of sourceId / sourceGroupId identifies the target. */
  create: async (
    orgId: string,
    target: { sourceId?: string; sourceGroupId?: string },
    invitedBy: string,
    grantee: {
      userId?: string;
      email?: string;
      accessLevel?: ShareLinkAccess;
    },
  ): Promise<SourcePermission> => {
    const [row] = await db
      .insert(sourcePermissions)
      .values({
        org_id: orgId,
        source_id: target.sourceId ?? null,
        source_group_id: target.sourceGroupId ?? null,
        user_id: grantee.userId ?? null,
        email: grantee.email?.toLowerCase() ?? null,
        access_level: grantee.accessLevel ?? "view",
        invited_by: invitedBy,
      } as typeof sourcePermissions.$inferInsert)
      .returning();
    return row as SourcePermission;
  },

  update: async (
    orgId: string,
    id: string,
    data: { accessLevel?: ShareLinkAccess },
  ): Promise<SourcePermission | null> => {
    const updateData: Record<string, unknown> = {};
    if (data.accessLevel !== undefined)
      updateData.access_level = data.accessLevel;
    const [row] = await db
      .update(sourcePermissions)
      .set(updateData as Partial<typeof sourcePermissions.$inferInsert>)
      .where(
        and(eq(sourcePermissions.org_id, orgId), eq(sourcePermissions.id, id)),
      )
      .returning();
    return (row ?? null) as SourcePermission | null;
  },

  delete: async (orgId: string, id: string): Promise<boolean> => {
    await db
      .delete(sourcePermissions)
      .where(
        and(eq(sourcePermissions.org_id, orgId), eq(sourcePermissions.id, id)),
      );
    return true;
  },
};

// =============================================================================
// EVENT MONITOR QUERIES
// =============================================================================

export const eventMonitorQueries = {
  findByOrg: async (orgId: string): Promise<EventMonitorRecord[]> => {
    return (await db
      .select()
      .from(eventMonitors)
      .where(eq(eventMonitors.org_id, orgId))) as EventMonitorRecord[];
  },

  findBySource: async (
    orgId: string,
    sourceId: string,
  ): Promise<EventMonitorRecord[]> => {
    return (await db
      .select()
      .from(eventMonitors)
      .where(
        and(
          eq(eventMonitors.org_id, orgId),
          eq(eventMonitors.source_id, sourceId),
        ),
      )) as EventMonitorRecord[];
  },

  findByMetric: async (
    orgId: string,
    sourceId: string,
    metric: string,
  ): Promise<EventMonitorRecord | null> => {
    const rows = await db
      .select()
      .from(eventMonitors)
      .where(
        and(
          eq(eventMonitors.org_id, orgId),
          eq(eventMonitors.source_id, sourceId),
          eq(eventMonitors.metric, metric),
        ),
      )
      .limit(1);
    return (rows[0] ?? null) as EventMonitorRecord | null;
  },

  findEnabledBySource: async (
    orgId: string,
    sourceId: string,
  ): Promise<EventMonitorRecord[]> => {
    return (await db
      .select()
      .from(eventMonitors)
      .where(
        and(
          eq(eventMonitors.org_id, orgId),
          eq(eventMonitors.source_id, sourceId),
          eq(eventMonitors.enabled, true),
        ),
      )) as EventMonitorRecord[];
  },

  upsert: async (
    orgId: string,
    config: {
      source_id: string;
      metric: string;
      severity?: string;
      message?: string | null;
      enabled?: boolean;
      visualization?: {
        panel_type: string;
        panel_config: Record<string, unknown>;
      } | null;
      notification_target_ids?: string[] | null;
      table_name?: string | null;
      time_column?: string | null;
      context_columns?: string[] | null;
      filters?: EventMonitorFilter[] | null;
      delivery?: EventMonitorDelivery | null;
    },
  ): Promise<EventMonitorRecord[]> => {
    return (
      (await db
        .insert(eventMonitors)
        .values({
          org_id: orgId,
          source_id: config.source_id,
          metric: config.metric,
          severity: config.severity ?? "info",
          message: config.message ?? null,
          enabled: config.enabled ?? true,
          visualization: config.visualization ?? null,
          notification_target_ids: config.notification_target_ids ?? null,
          table_name: config.table_name ?? null,
          time_column: config.time_column ?? null,
          context_columns: config.context_columns ?? null,
          filters: config.filters ?? null,
          delivery: config.delivery ?? null,
        } as typeof eventMonitors.$inferInsert)
        // notification_target_ids: undefined = preserve existing routing on
        // reconfigure; only an explicit value (array or null) overwrites.
        .onConflictDoUpdate({
          target: [
            eventMonitors.org_id,
            eventMonitors.source_id,
            eventMonitors.metric,
          ],
          set: {
            severity: config.severity ?? "info",
            message: config.message ?? null,
            enabled: config.enabled ?? true,
            visualization: config.visualization ?? null,
            ...(config.notification_target_ids !== undefined
              ? { notification_target_ids: config.notification_target_ids }
              : {}),
            table_name: config.table_name ?? null,
            time_column: config.time_column ?? null,
            context_columns: config.context_columns ?? null,
            filters: config.filters ?? null,
            delivery: config.delivery ?? null,
            // Reconfiguring a monitor re-initializes its poll cursor; the init
            // tick never alerts, so this is safe and avoids stale watermarks
            // pointing at a different table.
            poll_watermark: null,
          },
        })
        .returning()) as EventMonitorRecord[]
    );
  },

  /**
   * Poll-loop state writer: watermark / last-polled bookkeeping, plus the
   * one-time table/time-column backfill for monitors created before those
   * columns existed.
   */
  updatePollState: async (
    orgId: string,
    id: string,
    data: {
      poll_watermark?: string | null;
      last_polled_at?: string;
      table_name?: string | null;
      time_column?: string | null;
      last_status?: string | null;
      last_error?: string | null;
      last_evaluated_at?: string;
    },
  ): Promise<void> => {
    await db
      .update(eventMonitors)
      .set(data as Partial<typeof eventMonitors.$inferInsert>)
      .where(and(eq(eventMonitors.org_id, orgId), eq(eventMonitors.id, id)));
  },

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
// DEVICE SCHEMA QUERIES (RLS - for UI and authenticated API routes)
// =============================================================================

export const deviceSchemaQueries = {
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

  findByOrg: async (orgId: string): Promise<DeviceSchemaRecord[]> => {
    return (await db
      .select()
      .from(deviceSchemas)
      .where(eq(deviceSchemas.org_id, orgId))
      .orderBy(
        asc(deviceSchemas.source_id),
        asc(deviceSchemas.metric),
      )) as DeviceSchemaRecord[];
  },
};

// =============================================================================
// COLUMN METADATA QUERIES (RLS, org-writable — authored from the Data tab)
// =============================================================================

/** Patch shape for a single-column upsert (all fields optional). */
export type ColumnMetadataPatch = Partial<
  Omit<
    ColumnMetadataRecord,
    "id" | "org_id" | "source_id" | "column_key" | "created_at" | "updated_at"
  >
>;

export const columnMetadataQueries = {
  findBySource: async (
    orgId: string,
    sourceSlug: string,
  ): Promise<ColumnMetadataRecord[]> => {
    return (await db
      .select()
      .from(columnMetadata)
      .where(
        and(
          eq(columnMetadata.org_id, orgId),
          eq(columnMetadata.source_id, sourceSlug),
        ),
      )
      .orderBy(asc(columnMetadata.column_key))) as ColumnMetadataRecord[];
  },

  upsert: async (
    orgId: string,
    sourceSlug: string,
    columnKey: string,
    patch: ColumnMetadataPatch,
  ): Promise<ColumnMetadataRecord> => {
    const [row] = await db
      .insert(columnMetadata)
      .values({
        org_id: orgId,
        source_id: sourceSlug,
        column_key: columnKey,
        ...patch,
      } as typeof columnMetadata.$inferInsert)
      .onConflictDoUpdate({
        target: [
          columnMetadata.org_id,
          columnMetadata.source_id,
          columnMetadata.column_key,
        ],
        set: patch as Partial<typeof columnMetadata.$inferInsert>,
      })
      .returning();
    return row as ColumnMetadataRecord;
  },

  remove: async (
    orgId: string,
    sourceSlug: string,
    columnKey: string,
  ): Promise<void> => {
    await db
      .delete(columnMetadata)
      .where(
        and(
          eq(columnMetadata.org_id, orgId),
          eq(columnMetadata.source_id, sourceSlug),
          eq(columnMetadata.column_key, columnKey),
        ),
      );
  },
};

/**
 * Read all column annotations for a source as a Map keyed by column_key.
 * Single read point for inference consumers (classifier, future ML/query).
 */
export async function getColumnMetadataMap(
  orgId: string,
  sourceSlug: string,
): Promise<Map<string, ColumnMetadataRecord>> {
  const rows = await columnMetadataQueries.findBySource(orgId, sourceSlug);
  return new Map(rows.map((r) => [r.column_key, r]));
}
