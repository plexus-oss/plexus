/**
 * POST /api/plexus — self-analytics beacon proxy.
 *
 * The product app dogfoods plexus-typescript: PageViewTracker beacons here,
 * and this route forwards to the ingest gateway under the `plexus-app`
 * source. The key is a dedicated org key (PLEXUS_SELF_ANALYTICS_KEY — NOT
 * PLEXUS_API_KEY, which is the customer-facing name in setup snippets; the
 * explicit gate below also stops the proxy's built-in PLEXUS_API_KEY env
 * fallback from ever engaging here). No key → 204 no-op, so local dev and
 * fresh deploys send nothing.
 */
import { createIngestProxy } from "plexus-typescript/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";

export const runtime = "nodejs";

const SELF_KEY = process.env.PLEXUS_SELF_ANALYTICS_KEY;

const handler = SELF_KEY
  ? createIngestProxy({
      sourceId: "plexus-app",
      apiKey: SELF_KEY,
      allowMetrics: ["page_view"],
      tagAllowlist: ["page"],
    })
  : null;

export async function POST(request: Request): Promise<Response> {
  if (!handler) return new Response(null, { status: 204 });
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
  return handler(request);
}
