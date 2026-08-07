import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { apiError } from "@/lib/api/errors";
import { queryTelemetry } from "@/lib/db/clickhouse";

const MAX_LIMIT = 100_000;
const DEFAULT_LIMIT = 10_000;
const DEFAULT_RANGE_MS = 60 * 60 * 1000;

function parseTimestamp(value: string | null, field: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw apiError(
      "VALIDATION_ERROR",
      `${field} must be a valid ISO 8601 timestamp`,
      { field, value },
    );
  }
  return d;
}

function parseLimit(value: string | null): number {
  if (!value) return DEFAULT_LIMIT;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw apiError("VALIDATION_ERROR", "limit must be a positive integer", {
      field: "limit",
      value,
    });
  }
  if (n > MAX_LIMIT) {
    throw apiError(
      "VALIDATION_ERROR",
      `limit must not exceed ${MAX_LIMIT}`,
      { field: "limit", value, max: MAX_LIMIT },
    );
  }
  return n;
}

export const GET = withDualAuth(
  async (request, { orgId }) => {
    const url = new URL(request.url);
    const source = url.searchParams.get("source") || undefined;
    const metricParam = url.searchParams.get("metric");
    const limit = parseLimit(url.searchParams.get("limit"));

    const endTime = parseTimestamp(url.searchParams.get("to"), "to") ?? new Date();
    const startTime =
      parseTimestamp(url.searchParams.get("from"), "from") ??
      new Date(endTime.getTime() - DEFAULT_RANGE_MS);

    if (startTime.getTime() >= endTime.getTime()) {
      throw apiError("VALIDATION_ERROR", "from must be earlier than to", {
        from: startTime.toISOString(),
        to: endTime.toISOString(),
      });
    }

    const metrics = metricParam
      ? metricParam.split(",").map((m) => m.trim()).filter(Boolean)
      : undefined;

    const rows = await queryTelemetry({
      orgId,
      sourceId: source,
      metrics: metrics && metrics.length > 1 ? metrics : undefined,
      metric: metrics && metrics.length === 1 ? metrics[0] : undefined,
      startTime,
      endTime,
      limit,
    });

    return NextResponse.json({
      data: rows,
      count: rows.length,
      query: {
        source: source ?? null,
        metric: metricParam ?? null,
        from: startTime.toISOString(),
        to: endTime.toISOString(),
        limit,
      },
    });
  },
  { requiredScope: "read" },
);
