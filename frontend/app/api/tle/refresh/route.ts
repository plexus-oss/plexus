/**
 * Bulk TLE Refresh
 *
 * POST /api/tle/refresh — re-fetch TLEs for stale satellite devices from CelesTrak.
 */

import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { sourceQueries } from "@/lib/db";
import { sourceToSatellite } from "@/lib/satellites/convert";
import type { Satellite } from "@/lib/db/types";

const CONCURRENCY = 5;

type TleUpdate = {
  id: string;
  tle_line1: string;
  tle_line2: string;
  tle_epoch: string;
  official_name?: string;
  tle_source?: "celestrak";
};

type FetchResult = {
  line1: string;
  line2: string;
  epoch: string;
  name?: string;
};

async function fetchFromCelestrak(
  baseUrl: string,
  cookie: string,
  noradId: number,
): Promise<FetchResult | null> {
  try {
    const res = await fetch(`${baseUrl}/api/tle/lookup?norad_id=${noradId}`, {
      headers: { cookie },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      line1: data.tle_line1,
      line2: data.tle_line2,
      epoch: data.tle_epoch,
      name: data.name,
    };
  } catch {
    return null;
  }
}

export const POST = withDualAuth(async (request, { orgId }) => {
  const maxAgeDays = 7;
  const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();

  const allDeviceSources = await sourceQueries.findByType(orgId, "device");
  const orbitalSources = allDeviceSources.filter(
    (s) => s.device_type === "satellite",
  );
  const satellites: Satellite[] = orbitalSources.map(sourceToSatellite);

  const stale = satellites.filter((s) => !s.tle_epoch || s.tle_epoch < cutoff);
  if (stale.length === 0) {
    return NextResponse.json({
      refreshed: 0,
      message: "All TLEs are up to date",
    });
  }

  const baseUrl = request.url.split("/api/")[0];
  const cookie = request.headers.get("cookie") || "";

  async function resolve(
    sat: Satellite,
  ): Promise<{ result: FetchResult; source: TleUpdate["tle_source"] } | null> {
    if (!sat.norad_id) return null;
    const r = await fetchFromCelestrak(baseUrl, cookie, sat.norad_id);
    return r ? { result: r, source: "celestrak" } : null;
  }

  const updates: TleUpdate[] = [];

  for (let i = 0; i < stale.length; i += CONCURRENCY) {
    const batch = stale.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (sat): Promise<TleUpdate | null> => {
        const resolved = await resolve(sat);
        if (!resolved) return null;
        return {
          id: sat.id,
          tle_line1: resolved.result.line1,
          tle_line2: resolved.result.line2,
          tle_epoch: resolved.result.epoch,
          official_name: resolved.result.name,
          tle_source: resolved.source,
        };
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) updates.push(r.value);
    }
  }

  if (updates.length > 0) {
    await sourceQueries.updateMetadataBatch(orgId, updates);
  }

  return NextResponse.json({
    refreshed: updates.length,
    total_stale: stale.length,
  });
});
