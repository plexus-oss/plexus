/**
 * GET /api/health/loader
 *
 * Probes the ch-loader to make missed-push failures visible from the
 * dashboard. The loader exposes a / and /healthz GET that returns its
 * internal _health dict; we proxy the most useful fields.
 *
 * Session-authed so we don't expose internal infrastructure status to
 * unauth'd visitors. The internal-secret on the request is the same
 * one pushToService uses, so a successful probe also confirms the env
 * var is wired up.
 *
 * Response (200): {
 *   reachable: boolean,
 *   reason?: "not_configured" | "http_error" | "network_error",
 *   status?: number,
 *   message?: string,
 *   lastRedis?: number | null,        // ms since epoch
 *   lastClickhouseInsert?: number | null,
 *   totalInserted?: number | null,
 *   streams?: number | null,
 * }
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";

export const GET = withAuth(async () => {
  const url = process.env.PLEXUS_LOADER_URL;
  const secret = process.env.PLEXUS_INTERNAL_SECRET;
  if (!url || !secret) {
    return NextResponse.json({
      reachable: false,
      reason: "not_configured",
      message:
        "PLEXUS_LOADER_URL or PLEXUS_INTERNAL_SECRET not set in this environment.",
    });
  }

  try {
    // The loader's HealthHandler returns the _health dict on any GET
    // path that isn't /metrics — so / works and is cheap.
    const res = await fetch(url.replace(/\/+$/, "") + "/", {
      method: "GET",
      // Loader doesn't require the secret on GET, but sending it is
      // harmless and consistent with our other internal calls.
      headers: { "x-internal-secret": secret },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({
        reachable: false,
        reason: "http_error",
        status: res.status,
      });
    }
    const json = (await res.json().catch(() => ({}))) as {
      last_redis?: number;
      last_ch_insert?: number;
      total_inserted?: number;
      streams?: number;
    };
    return NextResponse.json({
      reachable: true,
      lastRedis:
        typeof json.last_redis === "number" ? json.last_redis * 1000 : null,
      lastClickhouseInsert:
        typeof json.last_ch_insert === "number"
          ? json.last_ch_insert * 1000
          : null,
      totalInserted:
        typeof json.total_inserted === "number" ? json.total_inserted : null,
      streams: typeof json.streams === "number" ? json.streams : null,
    });
  } catch (err) {
    return NextResponse.json({
      reachable: false,
      reason: "network_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
