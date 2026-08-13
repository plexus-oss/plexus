/**
 * POST /api/plexus — self-analytics beacon proxy.
 *
 * PageViewTracker beacons here, and this route forwards to the ingest
 * gateway under the `plexus-app` source as a plain HTTP POST.
 * The key is a dedicated org key (PLEXUS_SELF_ANALYTICS_KEY — NOT
 * PLEXUS_API_KEY, which is the customer-facing name in setup snippets).
 * No key → 204 no-op, so local dev and fresh deploys send nothing.
 */
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";

export const runtime = "nodejs";

const SELF_KEY = process.env.PLEXUS_SELF_ANALYTICS_KEY;
const GATEWAY_URL =
  process.env.PLEXUS_GATEWAY_URL || "https://gateway.plexus.company";
const ALLOW_METRICS = new Set(["page_view"]);
const ALLOW_TAGS = new Set(["page"]);

export async function POST(request: Request): Promise<Response> {
  if (!SELF_KEY) return new Response(null, { status: 204 });
  const limit = checkRateLimit(
    `selfanalytics:${getClientIp(request)}`,
    20,
    1000,
  );
  if (!limit.allowed) {
    return new Response(null, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfter ?? 1) },
    });
  }

  let body: { metric?: unknown; value?: unknown; tags?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const metric = typeof body.metric === "string" ? body.metric : "";
  if (!ALLOW_METRICS.has(metric)) return new Response(null, { status: 400 });
  const value =
    typeof body.value === "number" && Number.isFinite(body.value)
      ? body.value
      : 1;
  const tags: Record<string, string> = {};
  if (body.tags && typeof body.tags === "object") {
    for (const [k, v] of Object.entries(body.tags as Record<string, unknown>)) {
      if (ALLOW_TAGS.has(k) && typeof v === "string" && v.length <= 200) {
        tags[k] = v;
      }
    }
  }

  // Fire-and-forget: analytics must never surface an error to the app.
  try {
    await fetch(`${GATEWAY_URL}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": SELF_KEY },
      body: JSON.stringify({
        source_id: "plexus-app",
        points: [{ metric, value, timestamp: Date.now(), tags }],
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // swallow — beacon delivery is best-effort
  }
  return new Response(null, { status: 204 });
}
