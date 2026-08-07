import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { queryEvents } from "@/lib/db/clickhouse";
import { filterAccessibleSlugs } from "@/lib/access/sources";
import { parseTimeRangeParam } from "@/lib/telemetry/time-range-param";

export const GET = withDualAuth(
  async (request, { orgId, userId, orgRole, isApiKeyAuth }) => {
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get("sourceId") || undefined;
    const name = searchParams.get("name") || undefined;
    const timeRange = searchParams.get("timeRange") || "1h";
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "500", 10),
      5000,
    );

    const { startTime, endTime } = parseTimeRangeParam(timeRange);

    try {
      let events = await queryEvents(orgId, sourceId, {
        startTime,
        endTime,
        name,
        limit,
      });
      // Scoped members only see events for sources they may view (device
      // events reference sources by slug; filterAccessibleSlugs bridges
      // slug → scope).
      if (!isApiKeyAuth && userId) {
        const slugs = [
          ...new Set(events.map((e) => e.source_id).filter(Boolean)),
        ] as string[];
        const ok = await filterAccessibleSlugs(
          { orgId, userId, orgRole, isApiKeyAuth },
          slugs,
        );
        events = events.filter((e) => !!e.source_id && ok.has(e.source_id));
      }
      return NextResponse.json({ events, total: events.length });
    } catch (error) {
      console.error("Error querying device events:", error);
      return NextResponse.json(
        { error: "Failed to fetch events" },
        { status: 500 },
      );
    }
  },
);
