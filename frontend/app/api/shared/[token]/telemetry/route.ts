import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { adminDashboardShareQueries } from "@/lib/db/server";
import { parseTimeRangeParam } from "@/lib/telemetry/time-range-param";
import { cachedJson } from "@/lib/utils";
import { queryTelemetry } from "@/lib/db/clickhouse";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

interface RouteParams {
  params: Promise<{ token: string }>;
}

/**
 * GET /api/shared/[token]/telemetry - Query telemetry for a shared dashboard (public access)
 *
 * Validates the share token and uses the org_id from the share link to query telemetry.
 * This bypasses user authentication but requires a valid, active share token.
 *
 * Supports real-time only mode: If ClickHouse is not configured, returns empty data
 * gracefully. The SharedTelemetryProvider can then fall back to WebSocket streams.
 *
 * Query params:
 * - metrics: comma-separated metric names (required)
 * - timeRange: relative time like "15m", "1h", "24h" (default: "15m")
 * - sourceId: filter by device (optional)
 * - limit: max points per metric (default: 1000)
 * - downsample: target number of points per metric (uses server-side aggregation)
 * - password: required if share link is password-protected
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;

    // Anonymous, DB-touching endpoint — limit per viewer (IP) per share token
    const rate = checkRateLimit(
      `shared-telemetry:${token}:${getClientIp(request)}`,
      60,
      60_000,
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter ?? 60) } },
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const providedPassword = searchParams.get("password");

    // Validate the share token
    const shareLink = await adminDashboardShareQueries.findByToken(token);
    if (!shareLink) {
      return NextResponse.json(
        { error: "Share link not found" },
        { status: 404 }
      );
    }

    // Check if share link is active
    if (shareLink.status !== "active") {
      return NextResponse.json(
        { error: "This share link has been revoked" },
        { status: 403 }
      );
    }

    // Check if share link has expired
    if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
      return NextResponse.json(
        { error: "This share link has expired" },
        { status: 403 }
      );
    }

    // Check if max views reached (telemetry queries don't count as new views)
    if (
      shareLink.max_views !== null &&
      shareLink.view_count >= shareLink.max_views
    ) {
      return NextResponse.json(
        { error: "This share link has reached its maximum view limit" },
        { status: 403 }
      );
    }

    // Check if password protected
    if (shareLink.password_hash) {
      if (!providedPassword) {
        return NextResponse.json(
          { error: "Password required", requiresPassword: true },
          { status: 401 }
        );
      }

      const passwordHash = hashPassword(providedPassword);
      if (passwordHash !== shareLink.password_hash) {
        return NextResponse.json(
          { error: "Incorrect password" },
          { status: 401 }
        );
      }
    }

    // Use org_id from the share link to query telemetry
    const orgId = shareLink.org_id;

    // Parse metrics parameter
    const metricsParam = searchParams.get("metrics");
    if (!metricsParam) {
      return NextResponse.json(
        { error: "metrics parameter is required" },
        { status: 400 }
      );
    }
    const metricKeys = metricsParam.split(",").map((m) => m.trim());

    // Parse device:metric format - supports both "source_id:metric" and plain "metric"
    // The metric name is always the last segment after the last colon
    const parsedMetrics = metricKeys.map((key) => {
      if (key.includes(":")) {
        const lastColonIndex = key.lastIndexOf(":");
        const metric = key.substring(lastColonIndex + 1);
        const sourceId = key.substring(0, lastColonIndex);
        // Handle double-prefixed metrics like "source:source:metric" -> extract just "source"
        const sourceIdParts = sourceId.split(":");
        const actualSourceId = sourceIdParts[0]; // Take first part as the real source ID
        return { key, sourceId: actualSourceId, metric };
      }
      return { key, sourceId: null, metric: key };
    });

    const timeRange = searchParams.get("timeRange") || "15m";

    const downsample = searchParams.get("downsample");
    const targetPoints = downsample ? parseInt(downsample, 10) : null;

    // Time window — relative ("15m") or absolute ("<startISO>/<endISO>").
    const { startTime, endTime } = parseTimeRangeParam(timeRange, "15m");
    // Clamp: anonymous endpoint, but multi-metric dashboard fetches
    // legitimately need well past the old 1000 default (which truncated
    // absolute windows to their newest tail).
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "1000", 10) || 1000, 1),
      50_000,
    );

    // Group by device:metric key
    const data: Record<
      string,
      Array<{ timestamp: string; value: number; source_id: string }>
    > = {};

    // Initialize empty arrays for all requested metrics
    for (const { key } of parsedMetrics) {
      data[key] = [];
    }

    // Group metrics by sourceId for efficient querying
    const metricsBySource = new Map<string | null, { key: string; metric: string }[]>();
    for (const parsed of parsedMetrics) {
      const sourceKey = parsed.sourceId;
      if (!metricsBySource.has(sourceKey)) {
        metricsBySource.set(sourceKey, []);
      }
      metricsBySource.get(sourceKey)!.push({ key: parsed.key, metric: parsed.metric });
    }

    // Query telemetry for each source group
    const queryPromises: Promise<void>[] = [];

    for (const [sourceId, metricsInfo] of metricsBySource) {
      const promise = (async () => {
        const metrics = metricsInfo.map(m => m.metric);
        const rows = await queryTelemetry({
          orgId,
          sourceId: sourceId || undefined,
          metrics,
          startTime,
          endTime,
          limit,
        });

        // Map results back to their keys
        for (const row of rows) {
          // Find the matching key for this row
          const matchingMetric = metricsInfo.find(m => m.metric === row.metric);
          if (matchingMetric) {
            // Normalize to ISO-8601 UTC. ClickHouse returns UTC text like
            // "2026-07-28 21:00:13.824" (space separator, no zone). Every
            // client consumer assumes ISO: usePanelData's window clip does
            // STRING comparison against ISO bounds (' ' < 'T' made every
            // shared historical point sort before the window start — panels
            // showed "no data" for any absolute range), and new Date() on
            // the zoneless form parses as LOCAL time (silent tz shift).
            const raw = typeof row.timestamp === "string"
              ? row.timestamp
              : row.timestamp.toISOString();
            const timestamp = raw.includes("T")
              ? raw
              : raw.replace(" ", "T") + "Z";

            data[matchingMetric.key].push({
              timestamp,
              value: row.value,
              source_id: row.source_id,
            });
          }
        }
      })();
      queryPromises.push(promise);
    }

    await Promise.all(queryPromises);

    // Sort each metric's data by timestamp
    for (const key of Object.keys(data)) {
      data[key].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }

    // Apply downsampling if requested (simple decimation for now)
    if (targetPoints && targetPoints > 0) {
      for (const key of Object.keys(data)) {
        const points = data[key];
        if (points.length > targetPoints) {
          const step = points.length / targetPoints;
          const downsampled: typeof points = [];
          for (let i = 0; i < targetPoints; i++) {
            const idx = Math.floor(i * step);
            downsampled.push(points[idx]);
          }
          data[key] = downsampled;
        }
      }
    }

    return cachedJson({ data }, { maxAge: 5, staleWhileRevalidate: 15 });
  } catch (error) {
    console.error("Shared telemetry query error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
