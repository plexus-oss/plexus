/**
 * CelesTrak SATCAT Proxy API
 *
 * GET /api/tle/satcat?norad_id=25544
 *
 * Returns satellite catalog metadata from the public CelesTrak SATCAT.
 * No auth required — CelesTrak is a free public data source.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";

/** Expand CelesTrak abbreviated object type codes to full names */
function expandObjectType(code: unknown): string {
  const map: Record<string, string> = {
    PAY: "PAYLOAD",
    "R/B": "ROCKET BODY",
    DEB: "DEBRIS",
    UNK: "UNKNOWN",
    TBA: "UNKNOWN",
  };
  return map[String(code ?? "").trim()] ?? String(code ?? "UNKNOWN");
}

/** Derive RCS size category from radar cross-section in m² */
function deriveRcsSize(rcs: unknown): "SMALL" | "MEDIUM" | "LARGE" | null {
  if (rcs == null || rcs === "") return null;
  const val = Number(rcs);
  if (isNaN(val)) return null;
  if (val > 1.0) return "LARGE";
  if (val > 0.1) return "MEDIUM";
  return "SMALL";
}

export async function GET(request: NextRequest) {
  try {
    // Open proxy to CelesTrak — limit per IP to be a good citizen
    const rate = checkRateLimit(`satcat:${getClientIp(request)}`, 30, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter ?? 60) } },
      );
    }

    const noradId = request.nextUrl.searchParams.get("norad_id");

    if (!noradId) {
      return NextResponse.json(
        { error: "Missing norad_id parameter" },
        { status: 400 }
      );
    }

    const res = await fetch(
      `https://celestrak.org/satcat/records.php?CATNR=${encodeURIComponent(noradId)}&FORMAT=json`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
        next: { revalidate: 86400 }, // cache 24h
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `CelesTrak returned ${res.status}` },
        { status: res.status >= 500 ? 502 : res.status }
      );
    }

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      // CelesTrak returns plain text like "No SATCAT entry found" for unknown IDs
      return NextResponse.json({ error: "No SATCAT record found" }, { status: 404 });
    }
    const records = Array.isArray(data) ? data : [data];

    if (records.length === 0) {
      return NextResponse.json(
        { error: "No SATCAT record found" },
        { status: 404 }
      );
    }

    // CelesTrak returns fields in various casing — normalize
    const r = records[0] as Record<string, unknown>;

    // CelesTrak field names: OBJECT_TYPE (abbreviated), OWNER (not COUNTRY_CODE),
    // RCS (numeric m², not RCS_SIZE), LAUNCH_SITE (not SITE), DECAY_DATE (empty string = null)
    const rawType = r.OBJECT_TYPE ?? r.object_type;
    const rawRcs = r.RCS ?? r.rcs;
    const decayDate = r.DECAY_DATE ?? r.decay_date;

    const result = {
      object_name: r.OBJECT_NAME ?? r.object_name ?? null,
      object_type: expandObjectType(rawType),
      norad_id: Number(r.NORAD_CAT_ID ?? r.norad_cat_id ?? noradId),
      intl_designator: r.OBJECT_ID ?? r.INTLDES ?? r.intldes ?? null,
      country: r.OWNER ?? r.owner ?? null,
      launch_date: r.LAUNCH_DATE ?? r.launch_date ?? null,
      launch_site: r.LAUNCH_SITE ?? r.launch_site ?? null,
      decay_date: decayDate && String(decayDate).trim() !== "" ? decayDate : null,
      rcs_size: deriveRcsSize(rawRcs),
      period: r.PERIOD != null ? Number(r.PERIOD) : r.period != null ? Number(r.period) : null,
      apogee: r.APOGEE != null ? Number(r.APOGEE) : r.apogee != null ? Number(r.apogee) : null,
      perigee: r.PERIGEE != null ? Number(r.PERIGEE) : r.perigee != null ? Number(r.perigee) : null,
      inclination: r.INCLINATION != null ? Number(r.INCLINATION) : r.inclination != null ? Number(r.inclination) : null,
    };

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600" },
    });
  } catch (error) {
    console.error("[SATCAT]", error);
    return NextResponse.json(
      { error: "Failed to fetch SATCAT data" },
      { status: 500 }
    );
  }
}
