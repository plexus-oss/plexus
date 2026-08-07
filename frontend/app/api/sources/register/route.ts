/**
 * POST /api/sources/register — Idempotent source registration + schema capture
 *
 * Called by the gateway metric announcer (or other internal services) when
 * encountering an unknown source slug. Creates the source, captures metric
 * schemas, and
 * triggers AI classification once enough metrics are observed.
 *
 * Auth: x-internal-secret header (shared secret, not user-facing).
 */

import { NextRequest, NextResponse } from "next/server";
import { adminSourceQueries, adminDeviceSchemaQueries } from "@/lib/db/server";
import { isUuid } from "@/lib/utils/uuid";
import { pushToService } from "@/lib/internal/push";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const INTERNAL_SECRET = process.env.PLEXUS_INTERNAL_SECRET;

function verifyInternalAuth(request: NextRequest): boolean {
  if (!INTERNAL_SECRET) return false;
  return request.headers.get("x-internal-secret") === INTERNAL_SECRET;
}

// ---------------------------------------------------------------------------
// Slug validation (same pattern as old ingest route)
// ---------------------------------------------------------------------------

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

// ---------------------------------------------------------------------------
// Process-level caches
// ---------------------------------------------------------------------------

const autoCreatedSourceCache = new Set<string>();

// Per-metric accumulated stats within a single registration request.
interface SchemaStats {
  value_type: string;
  min: number | null;
  max: number | null;
  count: number;
}

// ---------------------------------------------------------------------------
// Schema capture (synchronous — persisted before the request returns)
// ---------------------------------------------------------------------------

type FlexValue =
  | number
  | string
  | boolean
  | Record<string, unknown>
  | unknown[];

function inferValueType(value: FlexValue): string {
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array";
  return "object";
}

interface PointForSchema {
  metric: string;
  value: unknown;
  timestamp: number;
}

// Persist discovered metric schemas synchronously so the metric is
// queryable the moment registration returns.
//
// HTTP /ingest announces each (org, source, metric) tuple exactly once: the
// gateway dedups in-memory and never re-sends, and there is no heartbeat to
// retry (unlike WS devices, which re-announce every heartbeat via
// PostForSource). A deferred, error-swallowing write would therefore lose
// the schema permanently if it dropped — and the Data tab reads only
// device_schemas, so the metric would never appear. upsert_device_schemas
// is idempotent, so awaiting it here is both safe and reliable.
async function persistSchemas(
  orgId: string,
  sourceSlug: string,
  points: PointForSchema[],
): Promise<void> {
  const metricMap = new Map<string, SchemaStats>();

  for (const point of points) {
    const vtype = inferValueType(point.value as FlexValue);
    const numValue = typeof point.value === "number" ? point.value : null;
    const existing = metricMap.get(point.metric);

    if (existing) {
      existing.count++;
      if (numValue !== null) {
        existing.min =
          existing.min !== null ? Math.min(existing.min, numValue) : numValue;
        existing.max =
          existing.max !== null ? Math.max(existing.max, numValue) : numValue;
      }
    } else {
      metricMap.set(point.metric, {
        value_type: vtype,
        min: numValue,
        max: numValue,
        count: 1,
      });
    }
  }

  if (metricMap.size === 0) return;

  const metrics = Array.from(metricMap.entries()).map(([metric, entry]) => ({
    metric,
    value_type: entry.value_type,
    sample_count: entry.count,
    min_value: entry.min,
    max_value: entry.max,
  }));

  await adminDeviceSchemaQueries.upsertBatch(orgId, sourceSlug, metrics);
}

async function autoCreateSource(
  orgId: string,
  slug: string,
): Promise<{ created: boolean; source_id?: string }> {
  const cacheKey = `${orgId}:${slug}`;
  if (autoCreatedSourceCache.has(cacheKey)) {
    return { created: false }; // already exists
  }

  // Reject uuid-shaped slugs too: resolveRef treats uuid-shaped refs as ids,
  // so such a slug would be unreachable everywhere downstream.
  if (!SLUG_PATTERN.test(slug) || isUuid(slug)) {
    return { created: false };
  }

  try {
    const sources = await adminSourceQueries.insert(orgId, {
      source_type: "device",
      slug,
      status: "pending",
      config: { recording: true },
      metadata: { auto_created: true },
    });

    autoCreatedSourceCache.add(cacheKey);

    console.log(
      JSON.stringify({ event: "source_auto_created", org: orgId, slug }),
    );
    return { created: true, source_id: sources?.[0]?.id };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : ((err as { message?: string })?.message ?? JSON.stringify(err));
    autoCreatedSourceCache.add(cacheKey);
    // The source already exists (concurrent register / cache cleared on restart).
    // Drizzle wraps the pg error, so the unique-violation code (23505) is on
    // err.cause — the message is just "Failed query: …". Check both.
    const pgCode = (err as { cause?: { code?: string } })?.cause?.code;
    if (
      pgCode === "23505" ||
      message.includes("duplicate") ||
      message.includes("unique")
    ) {
      return { created: false };
    }
    console.error(
      JSON.stringify({
        event: "auto_create_source_failed",
        org: orgId,
        slug,
        error: message,
      }),
    );
    return { created: false };
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  if (!verifyInternalAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { org_id, slug, points } = body as {
      org_id?: string;
      slug?: string;
      points?: PointForSchema[];
    };

    if (!org_id || !slug) {
      return NextResponse.json(
        { error: "org_id and slug are required" },
        { status: 400 },
      );
    }

    // Auto-create source if it doesn't exist
    const result = await autoCreateSource(org_id, slug);

    let loaderPush: Awaited<ReturnType<typeof pushToService>> | null = null;
    if (result.created) {
      loaderPush = await pushToService(
        process.env.PLEXUS_LOADER_URL,
        process.env.PLEXUS_INTERNAL_SECRET,
        "/recording",
        { org_id, source_id: slug, recording: true },
        "loader-recording",
      );
    }

    // Capture schemas if points were provided. Awaited so the metric is
    // persisted before we respond — the gateway announces HTTP-ingested
    // metrics only once, so a dropped write would never be retried.
    if (points && Array.isArray(points) && points.length > 0) {
      try {
        await persistSchemas(org_id, slug, points);
      } catch (err) {
        // Never fail registration due to schema capture, but log it — a
        // silently swallowed failure here is exactly how metrics went missing.
        console.error(
          JSON.stringify({
            event: "schema_capture_failed",
            org: org_id,
            source: slug,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    const response: Record<string, unknown> = {
      success: true,
      created: result.created,
      source_id: result.source_id,
    };
    if (loaderPush) {
      response.loaderPush = loaderPush;
    }
    return NextResponse.json(response);
  } catch (error) {
    console.error("[sources/register] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
