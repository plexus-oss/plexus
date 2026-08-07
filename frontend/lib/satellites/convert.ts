/**
 * Satellite ↔ Source conversion helpers
 *
 * Pure functions to map between the unified `sources` model
 * and the legacy `Satellite` row shape.
 */

import type {
  Source,
  Satellite,
  Json,
  SatelliteSourceMetadata,
} from "@/lib/db/types";

/**
 * Convert a Source row (device_type="satellite") into the Satellite shape
 * that the frontend expects.
 */
export function sourceToSatellite(source: Source): Satellite {
  const meta = (source.metadata ?? {}) as Record<string, unknown>;

  return {
    id: source.id,
    org_id: source.org_id,
    norad_id: (meta.norad_id as number) ?? 0,
    name: source.name ?? `SAT-${meta.norad_id ?? "unknown"}`,
    official_name: (meta.official_name as string) ?? null,
    color: (meta.color as string) ?? "#3b82f6",
    group_name: (meta.group_name as string) ?? null,
    tle_line1: (meta.tle_line1 as string) ?? null,
    tle_line2: (meta.tle_line2 as string) ?? null,
    tle_epoch: (meta.tle_epoch as string) ?? null,
    tle_fetched_at: (meta.tle_fetched_at as string) ?? null,
    metadata: {
      tle_source: meta.tle_source ?? undefined,
      tle_data_source: meta.tle_data_source ?? undefined,
    } as Json,
    created_at: source.created_at,
    updated_at: source.updated_at,
  };
}

/**
 * Build source fields from satellite input data for insert/update.
 * Returns the subset of Source fields that should be set.
 */
export function satelliteToSourceFields(sat: {
  norad_id: number;
  name: string;
  official_name?: string | null;
  color?: string;
  group_name?: string | null;
  tle_line1?: string | null;
  tle_line2?: string | null;
  tle_epoch?: string | null;
  tle_fetched_at?: string | null;
  tle_source?: "celestrak";
}): {
  slug: string;
  name: string;
  device_type: string;
  metadata: SatelliteSourceMetadata;
} {
  return {
    slug: `sat-${sat.norad_id}`,
    name: sat.name,
    device_type: "satellite",
    metadata: {
      norad_id: sat.norad_id,
      official_name: sat.official_name ?? null,
      color: sat.color ?? "#3b82f6",
      group_name: sat.group_name ?? null,
      tle_line1: sat.tle_line1 ?? null,
      tle_line2: sat.tle_line2 ?? null,
      tle_epoch: sat.tle_epoch ?? null,
      tle_fetched_at: sat.tle_fetched_at ?? null,
      ...(sat.tle_source ? { tle_source: sat.tle_source } : {}),
    },
  };
}
