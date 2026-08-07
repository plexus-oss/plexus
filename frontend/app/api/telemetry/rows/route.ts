import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { queryTelemetry, countTelemetry } from "@/lib/db/clickhouse";
import { parseTimeRangeParam } from "@/lib/telemetry/time-range-param";
import { cachedJson } from "@/lib/utils";
import { filterAccessibleSlugs } from "@/lib/access/sources";

/**
 * GET /api/telemetry/rows - Get raw (tall) telemetry rows for table display
 *
 * Query params:
 * - sourceId (required)
 * - timeRange: Relative time range like "1h", "24h", "7d" (default: "24h")
 * - limit: Max rows to return (default: 100, max: 1000)
 * - offset: Pagination offset (default: 0)
 * - metric: Filter by exact metric name (optional)
 */
export const GET = withAuth(async (request, { userId, orgId, orgRole }) => {
  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get("sourceId");
  const timeRange = searchParams.get("timeRange") || "24h";
  const limit = Math.min(
    parseInt(searchParams.get("limit") || "100", 10),
    1000
  );
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const metric = searchParams.get("metric") || undefined;

  if (!sourceId) {
    return NextResponse.json(
      { error: "sourceId is required" },
      { status: 400 }
    );
  }

  // Access filter: if the user can't view this device, return no rows.
  const accessible = await filterAccessibleSlugs(
    { orgId, userId, orgRole, isApiKeyAuth: false },
    [sourceId],
  );
  if (!accessible.has(sourceId)) {
    return cachedJson(
      { rows: [], columns: ["timestamp", "metric", "value"], total: 0, hasMore: false },
      { maxAge: 5, staleWhileRevalidate: 10 },
    );
  }

  // Parse time range. "all" means no bounds; otherwise accept relative or
  // absolute ("<startISO>/<endISO>") forms.
  let startTime: Date | undefined;
  let endTime: Date | undefined;

  if (timeRange !== "all") {
    ({ startTime, endTime } = parseTimeRangeParam(timeRange, "24h"));
  }

  const [rawRows, total] = await Promise.all([
    queryTelemetry({
      orgId,
      sourceId,
      startTime,
      endTime,
      limit,
      offset,
      metric,
      excludeFrame: true,
      orderBy: "desc",
    }),
    countTelemetry({ orgId, sourceId, startTime, endTime, metric }),
  ]);

  const rows = rawRows.map((r) => ({
    timestamp:
      typeof r.timestamp === "string"
        ? r.timestamp
        : r.timestamp instanceof Date
          ? r.timestamp.toISOString()
          : String(r.timestamp),
    metric: r.metric,
    value: r.value,
  }));

  const hasMore = offset + limit < total;

  return cachedJson(
    { rows, columns: ["timestamp", "metric", "value"], total, hasMore },
    { maxAge: 5, staleWhileRevalidate: 10 }
  );
});
