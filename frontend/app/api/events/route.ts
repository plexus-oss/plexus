/**
 * System Events API - Read-only activity feed
 *
 * GET /api/events - Query system events with filters
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { systemEventQueries } from "@/lib/db";
import { adminOrgMemberQueries } from "@/lib/db/server";
import { loadAllowedSourceIds } from "@/lib/access/sources";

export async function GET(request: NextRequest) {
  try {
    const { orgId, userId } = await getAuth();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category") || undefined;
    const eventType = searchParams.get("type") || undefined;
    const severity = searchParams.get("severity") || undefined;
    const sourceId = searchParams.get("sourceId") || undefined;
    const search = searchParams.get("search") || undefined;
    const startTime = searchParams.get("startTime") || undefined;
    const endTime = searchParams.get("endTime") || undefined;
    const limit = Math.min(
      searchParams.get("limit")
        ? parseInt(searchParams.get("limit")!, 10)
        : 200,
      5000,
    );
    const offset = searchParams.get("offset")
      ? parseInt(searchParams.get("offset")!, 10)
      : undefined;

    const result = await systemEventQueries.findAll(orgId, {
      category,
      eventType,
      severity,
      sourceId,
      search,
      startTime,
      endTime,
      limit,
      offset,
    });

    // Scope: external/guest users only see events for their allow-listed
    // sources (sourceless org events are hidden from them).
    if (userId) {
      const allowed = await loadAllowedSourceIds(orgId, userId);
      if (allowed) {
        result.events = result.events.filter(
          (e: { source_id?: string | null }) =>
            !!e.source_id && allowed.has(e.source_id),
        );
      }
    }

    // Resolve actor profiles
    const actorIds = [
      ...new Set(
        result.events
          .map((e: { actor_id: string | null }) => e.actor_id)
          .filter((id: string | null): id is string => !!id),
      ),
    ];

    const actors: Record<string, { name: string; imageUrl: string }> = {};
    if (actorIds.length > 0) {
      try {
        const members = await adminOrgMemberQueries.findByUserIds(
          orgId,
          actorIds,
        );
        for (const member of members) {
          actors[member.user_id] = {
            name:
              [member.first_name, member.last_name].filter(Boolean).join(" ") ||
              member.email ||
              "Unknown",
            imageUrl: member.image_url ?? "",
          };
        }
      } catch {
        // Non-critical — return events without actor enrichment
      }
    }

    return NextResponse.json({ ...result, actors });
  } catch (error) {
    console.error("Error fetching system events:", error);
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 },
    );
  }
}
