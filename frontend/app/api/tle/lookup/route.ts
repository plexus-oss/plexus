/**
 * TLE Lookup Proxy
 *
 * GET /api/tle/lookup?norad_id=25544
 * GET /api/tle/lookup?name=ISS
 *
 * Server-side proxy to CelesTrak.
 * Single point for "get me a TLE for this identifier".
 */

import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { apiError } from "@/lib/api/errors";

/** Parse TLE epoch from line 1 (chars 18-32) */
function parseTleEpoch(line1: string): string {
  const epochStr = line1.substring(18, 32).trim();
  const year2 = parseInt(epochStr.substring(0, 2), 10);
  const dayFraction = parseFloat(epochStr.substring(2));
  const year = year2 >= 57 ? 1900 + year2 : 2000 + year2;
  const epoch = new Date(Date.UTC(year, 0, 1));
  epoch.setTime(epoch.getTime() + (dayFraction - 1) * 86400000);
  return epoch.toISOString();
}

/** Extract orbital params from TLE line 2 */
function extractOrbitalParams(line1: string, line2: string) {
  const inclination = parseFloat(line2.substring(8, 16).trim());
  const raan = parseFloat(line2.substring(17, 25).trim());
  const eccentricity = parseFloat("0." + line2.substring(26, 33).trim());
  const argPerigee = parseFloat(line2.substring(34, 42).trim());
  const meanAnomaly = parseFloat(line2.substring(43, 51).trim());
  const meanMotion = parseFloat(line2.substring(52, 63).trim());

  const periodMinutes = 1440 / meanMotion;
  const mu = 398600.4418;
  const periodSeconds = periodMinutes * 60;
  const semiMajorAxis = Math.pow(
    (mu * periodSeconds * periodSeconds) / (4 * Math.PI * Math.PI),
    1 / 3,
  );
  const altitude = semiMajorAxis - 6371;

  return {
    inclination,
    eccentricity,
    raan,
    argPerigee,
    meanAnomaly,
    meanMotion,
    period: periodMinutes,
    altitude,
  };
}

/** Fetch TLE from CelesTrak */
async function lookupFromCelesTrak(
  noradId: string | null,
  name: string | null,
) {
  let celestrakUrl: string;
  if (noradId) {
    celestrakUrl = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${encodeURIComponent(noradId)}&FORMAT=TLE`;
  } else {
    celestrakUrl = `https://celestrak.org/NORAD/elements/gp.php?NAME=${encodeURIComponent(name!)}&FORMAT=TLE`;
  }

  const res = await fetch(celestrakUrl, {
    headers: { "User-Agent": "Plexus/1.0" },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw apiError(
      "INTERNAL_ERROR",
      `CelesTrak returned ${res.status}: ${res.statusText}`,
    );
  }

  const text = await res.text();
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.trim());

  if (
    lines.length < 3 ||
    !lines[1].startsWith("1 ") ||
    !lines[2].startsWith("2 ")
  ) {
    throw apiError("NOT_FOUND", "No TLE data found for the given query");
  }

  const officialName = lines[0];
  const tleLine1 = lines[1];
  const tleLine2 = lines[2];

  const parsedNoradId = parseInt(tleLine1.substring(2, 7).trim(), 10);
  const tleEpoch = parseTleEpoch(tleLine1);
  const orbitalParams = extractOrbitalParams(tleLine1, tleLine2);

  return NextResponse.json({
    name: officialName,
    norad_id: parsedNoradId,
    tle_line1: tleLine1,
    tle_line2: tleLine2,
    tle_epoch: tleEpoch,
    orbital_params: orbitalParams,
    tle_source: "celestrak",
  });
}

export const GET = withDualAuth(async (request) => {
  const url = new URL(request.url);
  const noradId = url.searchParams.get("norad_id");
  const name = url.searchParams.get("name");

  if (!noradId && !name) {
    throw apiError(
      "VALIDATION_ERROR",
      "Provide either norad_id or name query parameter",
    );
  }

  return lookupFromCelesTrak(noradId, name);
});
