import { NextResponse } from "next/server";
import { sourceGroupQueries } from "@/lib/db/supabase";
import { withAuth, requirePermission } from "@/lib/api/with-auth";
import { emitSystemEvent } from "@/lib/events/emit";
import type { SourceGroupFilterCriteria } from "@/lib/db/types";

/**
 * GET /api/sources/groups - List all source groups
 */
export const GET = withAuth(async (_request, { orgId }) => {
  const groups = await sourceGroupQueries.findAllWithCounts(orgId);

  return NextResponse.json({ groups });
});

/**
 * POST /api/sources/groups - Create a new source group
 */
export const POST = withAuth(async (request, ctx) => {
  const { userId, orgId } = ctx;

  await requirePermission(ctx, "action-create-fleet");

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

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "Name is required" },
      { status: 400 }
    );
  }

  // Validate filter criteria if provided
  if (filterCriteria) {
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

  // Merge sourceTypes into filter criteria if provided
  const mergedFilterCriteria = {
    ...(filterCriteria || {}),
    ...(sourceTypes ? { sourceTypes } : {}),
  };

  const groups = await sourceGroupQueries.insert(orgId, {
    name: name.trim(),
    description: description?.trim() || null,
    filter_criteria: mergedFilterCriteria,
    static_member_ids: staticMemberIds || [],
    color: color || null,
    icon: icon || null,
  });

  if (groups.length === 0) {
    return NextResponse.json(
      { error: "Failed to create group" },
      { status: 500 }
    );
  }

  emitSystemEvent({
    orgId,
    eventType: "group.created",
    category: "group",
    title: `Group "${name}" created`,
    severity: "success",
    entityId: groups[0].id,
    entityType: "group",
    actorId: userId,
  });

  // Return with member count
  const groupWithMembers = await sourceGroupQueries.findWithMembers(
    orgId,
    groups[0].id
  );

  return NextResponse.json({ group: groupWithMembers }, { status: 201 });
});
