import { NextResponse } from "next/server";
import { sourceGroupQueries } from "@/lib/db/supabase";
import { withAuth, requirePermission } from "@/lib/api/with-auth";
import { emitSystemEvent } from "@/lib/events/emit";
import type { SourceGroupFilterCriteria } from "@/lib/db/types";

/**
 * GET /api/sources/groups/[id] - Get a source group with members
 */
export const GET = withAuth(async (_request, { orgId, params }) => {
  const { id } = await params;

  const group = await sourceGroupQueries.findWithMembers(orgId, id);

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  return NextResponse.json({ group });
});

/**
 * PATCH /api/sources/groups/[id] - Update a source group
 */
export const PATCH = withAuth(async (request, ctx) => {
  const { orgId, params } = ctx;

  await requirePermission(ctx, "action-edit-fleet");

  const { id } = await params;
  const body = await request.json();
  const {
    name,
    description,
    filterCriteria,
    staticMemberIds,
    color,
    icon,
    sourceTypes,
  } = body;

  // Validate filter criteria if provided
  if (filterCriteria !== undefined) {
    const criteria = filterCriteria as SourceGroupFilterCriteria;
    if (criteria.healthScoreMin !== undefined) {
      if (
        typeof criteria.healthScoreMin !== "number" ||
        criteria.healthScoreMin < 0 ||
        criteria.healthScoreMin > 100
      ) {
        return NextResponse.json(
          { error: "healthScoreMin must be a number between 0 and 100" },
          { status: 400 }
        );
      }
    }
    if (criteria.healthScoreMax !== undefined) {
      if (
        typeof criteria.healthScoreMax !== "number" ||
        criteria.healthScoreMax < 0 ||
        criteria.healthScoreMax > 100
      ) {
        return NextResponse.json(
          { error: "healthScoreMax must be a number between 0 and 100" },
          { status: 400 }
        );
      }
    }
  }

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name.trim();
  if (description !== undefined)
    updateData.description = description?.trim() || null;
  if (filterCriteria !== undefined)
    updateData.filter_criteria = filterCriteria;
  if (staticMemberIds !== undefined)
    updateData.static_member_ids = staticMemberIds;
  if (color !== undefined) updateData.color = color || null;
  if (icon !== undefined) updateData.icon = icon || null;

  // Merge sourceTypes into filter_criteria if provided
  if (sourceTypes !== undefined) {
    const existingCriteria =
      (updateData.filter_criteria as Record<string, unknown>) || {};
    updateData.filter_criteria = { ...existingCriteria, sourceTypes };
  }

  const groups = await sourceGroupQueries.update(orgId, id, updateData);

  if (groups.length === 0) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // Return with updated member count
  const groupWithMembers = await sourceGroupQueries.findWithMembers(
    orgId,
    id
  );

  return NextResponse.json({ group: groupWithMembers });
});

/**
 * DELETE /api/sources/groups/[id] - Delete a source group
 */
export const DELETE = withAuth(async (_request, ctx) => {
  const { userId, orgId, params } = ctx;

  await requirePermission(ctx, "action-delete-fleet");

  const { id } = await params;

  const groups = await sourceGroupQueries.delete(orgId, id);

  if (groups.length === 0) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  emitSystemEvent({
    orgId,
    eventType: "group.deleted",
    category: "group",
    title: `Group deleted`,
    severity: "warning",
    entityId: id,
    entityType: "group",
    actorId: userId,
  });

  return NextResponse.json({ success: true });
});
