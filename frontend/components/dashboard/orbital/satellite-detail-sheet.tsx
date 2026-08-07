"use client";

/**
 * Satellite Detail Sheet
 *
 * SatCat-style right slide-out panel: data-dense, scientific,
 * collapsible sections, clean label:value rows, orbital ephemeris,
 * and CelesTrak SATCAT catalog metadata.
 */

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Database, Globe, Link2, X } from "lucide-react";
import type { Satellite } from "@/lib/db/types";
import {
  getOrbitalElements,
  getTleEpoch,
  propagateSGP4,
} from "@/lib/orbital/propagation";
import { useSatcat } from "@/hooks/use-satcat";
import { useSourceData } from "@/hooks/use-source-data";
import type { QueryResult } from "@/hooks/use-connection-query";
import { useConnectionSchema } from "@/hooks/use-connection-schema";
import { useSources } from "@/hooks/use-sources";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  CollapsibleSection,
  LabelValueRow,
  parseIntlDesignator,
} from "./satellite/shared";
import { getOrbitRegime } from "./satellite/orbit-regime";

interface SatelliteDetailPanelProps {
  satellite: Satellite | null;
  onClose?: () => void;
}

// ─── Satellite Connection Data (dynamic schema discovery) ───────────────────

/** Column types that are numeric and should be charted */
const NUMERIC_TYPES = new Set([
  "number",
  "integer",
  "int",
  "int4",
  "int8",
  "bigint",
  "smallint",
  "float",
  "float4",
  "float8",
  "double",
  "double precision",
  "real",
  "numeric",
  "decimal",
]);

/** Column names that are IDs/keys, not chart-worthy values */
const SKIP_COLUMNS = new Set([
  "id",
  "orbit_id",
  "sat_id",
  "sat_no",
  "norad_id",
  "source_id",
  "device_id",
  "entity_id",
  "org_id",
]);

/** Column types that contain timestamps */
const TIMESTAMP_TYPES = new Set([
  "timestamp",
  "timestamptz",
  "timestamp with time zone",
  "timestamp without time zone",
  "date",
  "datetime",
]);

function isTimestampType(type: string): boolean {
  return TIMESTAMP_TYPES.has(type.toLowerCase().trim());
}

/** QNSOE column display mapping */
const QNSOE_COLUMNS: Record<string, { label: string; unit: string }> = {
  semi_major_axis: { label: "a", unit: "m" },
  a: { label: "a", unit: "m" },
  ecc_x: { label: "eₓ", unit: "" },
  ex: { label: "eₓ", unit: "" },
  ecc_y: { label: "eᵧ", unit: "" },
  ey: { label: "eᵧ", unit: "" },
  inclination: { label: "i", unit: "rad" },
  i: { label: "i", unit: "rad" },
  raan: { label: "Ω", unit: "rad" },
  omega: { label: "Ω", unit: "rad" },
  arg_latitude: { label: "u", unit: "rad" },
  u: { label: "u", unit: "rad" },
  arg_of_latitude: { label: "u", unit: "rad" },
};

function isQnsoeTable(name: string): boolean {
  return /qnsoe/i.test(name);
}

function isCovarianceTable(name: string): boolean {
  return /covariance.*3sigma|3sigma.*covariance/i.test(name);
}

function isNumericType(type: string): boolean {
  return NUMERIC_TYPES.has(type.toLowerCase().trim());
}

interface LinkedTableData {
  tableName: string;
  label: string;
  elements: Array<{
    label: string;
    unit: string;
    values: Array<{ time: number; value: number }>;
  }>;
}

function useSatelliteConnectionData(
  satellite: Satellite | null,
  enabled: boolean,
) {
  // First telemetry-linked connection on this satellite.
  const linkedConnection = useMemo(() => {
    const meta = satellite?.metadata;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
    const m = meta as Record<string, unknown>;
    const linked = m.linked_connections;
    if (!Array.isArray(linked) || linked.length === 0) return null;
    return linked[0] as {
      connection_id?: string;
      filter_column?: string;
      filter_value?: string;
    };
  }, [satellite?.metadata]);

  // Discover tables from the connection schema
  const { tables: schemaTables } = useConnectionSchema(
    linkedConnection?.connection_id ?? null,
  );

  // Build queries from schema discovery
  const queries = useMemo(() => {
    const result: Array<{
      table: string;
      connectionId: string;
      query: string;
    }> = [];

    if (linkedConnection?.connection_id && schemaTables.length > 0) {
      for (const table of schemaTables) {
        let q = `SELECT * FROM ${table.name}`;
        if (linkedConnection.filter_column && linkedConnection.filter_value) {
          const hasFilterCol = table.columns.some(
            (c) => c.name === linkedConnection.filter_column,
          );
          if (hasFilterCol) {
            q += ` WHERE "${linkedConnection.filter_column}" = '${linkedConnection.filter_value}'`;
          }
        }
        q += " LIMIT 200";

        result.push({
          table: table.name,
          connectionId: linkedConnection.connection_id,
          query: q,
        });
      }
    }

    return result.slice(0, 6);
  }, [linkedConnection, schemaTables]);

  const connectionId = queries[0]?.connectionId ?? null;

  // Execute queries (up to 6, hooks must be called unconditionally).
  // Going through useSourceData so these respect dashboard refresh, per-source
  // config, and hidden-tab pause.
  const q0 = useSourceData(
    { kind: "sql", sourceId: connectionId, sql: queries[0]?.query ?? "" },
    { enabled: enabled && !!queries[0] },
  );
  const q1 = useSourceData(
    { kind: "sql", sourceId: connectionId, sql: queries[1]?.query ?? "" },
    { enabled: enabled && !!queries[1] },
  );
  const q2 = useSourceData(
    { kind: "sql", sourceId: connectionId, sql: queries[2]?.query ?? "" },
    { enabled: enabled && !!queries[2] },
  );
  const q3 = useSourceData(
    { kind: "sql", sourceId: connectionId, sql: queries[3]?.query ?? "" },
    { enabled: enabled && !!queries[3] },
  );
  const q4 = useSourceData(
    { kind: "sql", sourceId: connectionId, sql: queries[4]?.query ?? "" },
    { enabled: enabled && !!queries[4] },
  );
  const q5 = useSourceData(
    { kind: "sql", sourceId: connectionId, sql: queries[5]?.query ?? "" },
    { enabled: enabled && !!queries[5] },
  );

  const queryResults = [q0, q1, q2, q3, q4, q5].map(
    (r) => r.data as QueryResult | null,
  );

  // Transform each table's results into chart elements
  const tableData = useMemo<LinkedTableData[]>(() => {
    const results: LinkedTableData[] = [];

    for (let i = 0; i < queries.length; i++) {
      const qr = queryResults[i];
      const rows = qr?.rows;
      const columns = qr?.columns;
      if (!rows || rows.length < 2 || !columns) continue;

      // Detect timestamp column for real time axis
      const timeCol = columns.find((c) => isTimestampType(c.type));

      // Find numeric columns worth charting
      const numericCols = columns
        .filter(
          (c) =>
            isNumericType(c.type) && !SKIP_COLUMNS.has(c.name.toLowerCase()),
        )
        .slice(0, 6);

      if (numericCols.length === 0) continue;

      // For QNSOE tables, reorder columns to match standard display order
      const tableName = queries[i].table;
      const isQnsoe = isQnsoeTable(tableName);
      let displayCols = numericCols;

      if (isQnsoe) {
        // Sort by QNSOE order, keeping only recognized columns
        const qnsoeOrder = Object.keys(QNSOE_COLUMNS);
        const recognized = numericCols.filter(
          (c) => QNSOE_COLUMNS[c.name.toLowerCase()],
        );
        const unrecognized = numericCols.filter(
          (c) => !QNSOE_COLUMNS[c.name.toLowerCase()],
        );
        recognized.sort(
          (a, b) =>
            qnsoeOrder.indexOf(a.name.toLowerCase()) -
            qnsoeOrder.indexOf(b.name.toLowerCase()),
        );
        displayCols = [...recognized, ...unrecognized].slice(0, 6);
      }

      const elements = displayCols.map((col) => {
        const qnsoeInfo = isQnsoe
          ? QNSOE_COLUMNS[col.name.toLowerCase()]
          : null;

        return {
          label: qnsoeInfo?.label ?? col.name,
          unit: qnsoeInfo?.unit ?? "",
          values: rows
            .filter((r) => r[col.name] != null)
            .map((r, idx) => {
              // Use real timestamps if available, hours from first point
              let time = idx;
              if (timeCol && r[timeCol.name] != null) {
                const ts = new Date(r[timeCol.name] as string).getTime() / 1000;
                time = ts;
              }
              return {
                time,
                value: Number(r[col.name]),
              };
            }),
        };
      });

      // Convert timestamps to hours-from-epoch if we have real timestamps
      if (timeCol && elements.length > 0 && elements[0].values.length > 0) {
        const firstTime = elements[0].values[0].time;
        for (const el of elements) {
          for (const v of el.values) {
            v.time = (v.time - firstTime) / 3600; // hours from epoch
          }
        }
      }

      results.push({
        tableName,
        label: isQnsoe
          ? "QNSOE Elements"
          : isCovarianceTable(tableName)
            ? "Covariance 3σ"
            : tableName
                .replace(/_/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase()),
        elements,
      });
    }

    return results;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries.length, q0.data, q1.data, q2.data, q3.data, q4.data, q5.data]);

  return {
    tableData,
    hasConnectionData: tableData.length > 0,
    connectionId: linkedConnection?.connection_id ?? null,
    connectionQueries: queries,
    isLoading: [q0, q1, q2, q3, q4, q5].some(
      (q, i) => i < queries.length && q.isLoading,
    ),
  };
}

// ─── Shared detail content (used by both Sheet and inline Panel) ────────────

function useSatelliteDetail(satellite: Satellite | null, enabled: boolean) {
  const { satcatInfo } = useSatcat(satellite?.norad_id ?? null, {
    enabled,
  });

  // Linked connection table data (auto-discovered from linked_connections)
  const { tableData, connectionId } = useSatelliteConnectionData(
    satellite,
    enabled,
  );

  const elements = useMemo(() => {
    const line1 = satellite?.tle_line1;
    const line2 = satellite?.tle_line2;
    if (!line1 || !line2) return null;
    try {
      return getOrbitalElements(line1, line2);
    } catch {
      return null;
    }
  }, [satellite?.tle_line1, satellite?.tle_line2]);

  const orbitRegime = useMemo(() => {
    if (!elements) return null;
    return getOrbitRegime(elements.altitude, elements.eccentricity);
  }, [elements]);

  const intlDesignator = useMemo(() => {
    const line1 = satellite?.tle_line1;
    if (!line1) return null;
    return parseIntlDesignator(line1);
  }, [satellite?.tle_line1]);

  const tleEpoch = useMemo(() => {
    const line1 = satellite?.tle_line1;
    if (!line1) return null;
    try {
      return getTleEpoch(line1);
    } catch {
      return null;
    }
  }, [satellite?.tle_line1]);

  const tleSource = useMemo(() => {
    const meta = satellite?.metadata;
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      const source = (meta as Record<string, unknown>).tle_source;
      if (source === "celestrak" || source === "connection") return source;
    }
    return null;
  }, [satellite?.metadata]);

  const ephemeris = useMemo(() => {
    const line1 = satellite?.tle_line1;
    const line2 = satellite?.tle_line2;
    if (!line1 || !line2 || !elements) return null;

    const tle = { line1, line2 };
    const periodMin = elements.period;
    const steps = 90;
    const now = new Date();

    const current = propagateSGP4(tle, now);
    if (!current) return null;

    const altitudes: number[] = [];
    const velocities: number[] = [];

    for (let i = 0; i <= steps; i++) {
      const offsetMin = (i / steps) * periodMin;
      const d = new Date(now.getTime() + offsetMin * 60000);
      const result = propagateSGP4(tle, d);
      if (!result) continue;

      const vel = result.velocity;
      altitudes.push(result.geodetic.alt);
      velocities.push(Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z));
    }

    if (altitudes.length < 2) return null;

    const vx = current.velocity.x;
    const vy = current.velocity.y;
    const vz = current.velocity.z;
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

    const eci = current.positionEci;
    const r = Math.sqrt(eci.x * eci.x + eci.y * eci.y + eci.z * eci.z);
    const dec = Math.asin(eci.z / r) * (180 / Math.PI);
    const ra = (Math.atan2(eci.y, eci.x) * (180 / Math.PI) + 360) % 360;

    return {
      current: {
        lat: current.geodetic.lat,
        lng: current.geodetic.lng,
        alt: current.geodetic.alt,
        speed,
        vx,
        vy,
        vz,
        ra,
        dec,
      },
      altitudes,
      velocities,
      period: periodMin,
      propagatedAt: now,
    };
  }, [satellite?.tle_line1, satellite?.tle_line2, elements]);

  const dataSourceLine = useMemo(() => {
    if (!satellite) return null;
    const parts: string[] = [];
    if (tleSource) {
      const label =
        tleSource === "celestrak" ? "CelesTrak" : "Custom Connection";
      parts.push(`via ${label}`);
    }
    if (tleEpoch)
      parts.push(`Epoch ${format(tleEpoch, "yyyy-MM-dd HH:mm")} UTC`);
    if (satellite.tle_fetched_at)
      parts.push(
        `fetched ${formatDistanceToNow(new Date(satellite.tle_fetched_at), { addSuffix: true })}`,
      );
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [satellite, tleSource, tleEpoch]);

  return {
    elements,
    orbitRegime,
    intlDesignator,
    tleEpoch,
    tleSource,
    ephemeris,
    dataSourceLine,
    satcatInfo,
    tableData,
    connectionId,
  };
}

/** Renders the detail body content shared between Sheet and Panel */
function SatelliteDetailContent({
  satellite,
  detail,
}: {
  satellite: Satellite;
  detail: ReturnType<typeof useSatelliteDetail>;
}) {
  const {
    elements,
    orbitRegime,
    intlDesignator,
    ephemeris,
    dataSourceLine,
    tleSource,
    satcatInfo,
    tableData,
    connectionId,
  } = detail;

  // Resolve connection name from ID
  const { sources } = useSources({ type: "connection" });
  const connectionName = useMemo(() => {
    if (!connectionId || !sources) return null;
    const conn = sources.find((s) => s.id === connectionId);
    return conn?.name ?? conn?.slug ?? null;
  }, [connectionId, sources]);

  // Build data sources summary
  const dataSources = useMemo(() => {
    const items: Array<{
      label: string;
      source: string;
      icon: "globe" | "link" | "database";
      tables?: string[];
    }> = [];

    // TLE source
    if (tleSource === "celestrak") {
      items.push({ label: "TLE", source: "CelesTrak", icon: "globe" });
    } else if (tleSource === "connection") {
      items.push({
        label: "TLE",
        source: connectionName ?? "Custom Connection",
        icon: "database",
      });
    }

    // Linked table data (QNSOE, Covariance, Observations, etc.)
    if (tableData.length > 0 && connectionName) {
      const tableNames = tableData.map((td) => td.tableName);
      items.push({
        label: "Orbital Data",
        source: connectionName,
        icon: "database",
        tables: tableNames,
      });
    }

    // SATCAT / catalog info from CelesTrak
    if (satcatInfo) {
      items.push({
        label: "Catalog (SATCAT)",
        source: "CelesTrak",
        icon: "globe",
      });
    }

    return items;
  }, [tleSource, connectionName, tableData, satcatInfo]);

  return (
    <>
      {/* ── Header ── */}
      <div className="pb-4 border-b border-border/50">
        <div className="flex items-center gap-2.5">
          <div
            className="h-3 w-3 rounded-full shrink-0"
            style={{ backgroundColor: satellite.color }}
          />
          <h3 className="text-base font-semibold">{satellite.name}</h3>
          {orbitRegime && (
            <Badge
              variant="outline"
              className={cn("text-[10px] py-0 h-5", orbitRegime.className)}
            >
              {orbitRegime.label}
            </Badge>
          )}
          {satcatInfo?.object_type && satcatInfo.object_type !== "UNKNOWN" && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] py-0 h-5",
                satcatInfo.object_type === "PAYLOAD"
                  ? "border-blue-500/50 text-blue-400"
                  : satcatInfo.object_type === "ROCKET BODY"
                    ? "border-orange-500/50 text-orange-400"
                    : "border-red-500/50 text-red-400",
              )}
            >
              {satcatInfo.object_type}
            </Badge>
          )}
        </div>
        <div className="space-y-0.5 mt-1.5">
          <div className="flex items-center gap-3 text-xs">
            {satellite.norad_id && (
              <span className="font-mono">NORAD {satellite.norad_id}</span>
            )}
            {intlDesignator && (
              <span className="font-mono text-muted-foreground">
                {intlDesignator}
              </span>
            )}
            {satellite.group_name && (
              <span className="text-muted-foreground">
                {satellite.group_name}
              </span>
            )}
            {satcatInfo?.country && (
              <span className="font-mono text-muted-foreground">
                {satcatInfo.country}
              </span>
            )}
          </div>
          {satcatInfo?.launch_date && (
            <div className="text-[10px] text-muted-foreground">
              Launched {satcatInfo.launch_date}
              {satcatInfo.launch_site
                ? ` \u00b7 ${satcatInfo.launch_site}`
                : ""}
            </div>
          )}
          {dataSourceLine && (
            <div className="text-[10px] text-muted-foreground">
              {dataSourceLine}
            </div>
          )}
        </div>
      </div>

      {/* ── Data Sources ── */}
      {dataSources.length > 0 && (
        <div className="py-3 border-b border-border/50">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Data Sources
          </div>
          <div className="space-y-1.5">
            {dataSources.map((ds) => (
              <div key={ds.label} className="flex items-center gap-2 text-xs">
                {ds.icon === "globe" ? (
                  <Globe className="h-3 w-3 text-emerald-400 shrink-0" />
                ) : ds.icon === "link" ? (
                  <Link2 className="h-3 w-3 text-blue-400 shrink-0" />
                ) : (
                  <Database className="h-3 w-3 text-purple-400 shrink-0" />
                )}
                <span className="text-muted-foreground">{ds.label}</span>
                <Badge
                  variant="outline"
                  className="text-[10px] py-0 h-4 font-normal"
                >
                  {ds.source}
                </Badge>
                {ds.tables && (
                  <span className="text-[10px] text-muted-foreground/60">
                    {ds.tables.join(", ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-5 py-4">
        <CollapsibleSection label="Orbital Elements">
          {elements ? (
            <div>
              <LabelValueRow
                label="Inclination"
                value={`${elements.inclination.toFixed(4)}°`}
              />
              <LabelValueRow
                label="RAAN"
                value={`${elements.raan.toFixed(4)}°`}
              />
              <LabelValueRow
                label="Eccentricity"
                value={elements.eccentricity.toFixed(7)}
              />
              <LabelValueRow
                label="Arg of Perigee"
                value={`${elements.argPerigee.toFixed(4)}°`}
              />
              <LabelValueRow
                label="Mean Anomaly"
                value={`${elements.meanAnomaly.toFixed(4)}°`}
              />
              <LabelValueRow
                label="Semi-Major Axis"
                value={`${elements.semiMajorAxis.toFixed(1)} km`}
              />
              <LabelValueRow
                label="Apogee Altitude"
                value={`${elements.apogeeAlt.toFixed(1)} km`}
              />
              <LabelValueRow
                label="Perigee Altitude"
                value={`${elements.perigeeAlt.toFixed(1)} km`}
              />
              <LabelValueRow
                label="Mean Motion"
                value={`${elements.meanMotion.toFixed(8)} rev/day`}
              />
              <LabelValueRow
                label="Period"
                value={`${elements.period.toFixed(2)} min`}
              />
              <LabelValueRow
                label="B* Drag"
                value={elements.bstar.toExponential(4)}
                last
              />
            </div>
          ) : (
            <div className="text-xs text-muted-foreground py-4 text-center">
              No TLE data available
            </div>
          )}
        </CollapsibleSection>

        {/* ── Satellite Catalog (CelesTrak SATCAT) ── */}
        {satcatInfo && (
          <CollapsibleSection label="Satellite Catalog">
            <div>
              <LabelValueRow
                label="Object Type"
                value={satcatInfo.object_type ?? "UNKNOWN"}
              />
              <LabelValueRow
                label="RCS Size"
                value={satcatInfo.rcs_size ?? "—"}
              />
              <LabelValueRow
                label="Country / Owner"
                value={satcatInfo.country ?? "—"}
              />
              <LabelValueRow
                label="Launch Date"
                value={satcatInfo.launch_date ?? "—"}
              />
              <LabelValueRow
                label="Launch Site"
                value={satcatInfo.launch_site ?? "—"}
              />
              <LabelValueRow
                label="Orbital Status"
                value={satcatInfo.decay_date ? "Decayed" : "In Orbit"}
              />
              {satcatInfo.decay_date && (
                <LabelValueRow
                  label="Decay Date"
                  value={satcatInfo.decay_date}
                />
              )}
              {satcatInfo.period != null && (
                <LabelValueRow
                  label="Period"
                  value={`${satcatInfo.period.toFixed(1)} min`}
                />
              )}
              {satcatInfo.apogee != null && (
                <LabelValueRow
                  label="Apogee"
                  value={`${satcatInfo.apogee} km`}
                />
              )}
              {satcatInfo.perigee != null && (
                <LabelValueRow
                  label="Perigee"
                  value={`${satcatInfo.perigee} km`}
                />
              )}
              {satcatInfo.inclination != null && (
                <LabelValueRow
                  label="Inclination"
                  value={`${satcatInfo.inclination.toFixed(1)}°`}
                  last
                />
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* ── Current State ── */}
        {ephemeris && (
          <CollapsibleSection
            label="Current State"
            badge={
              <span className="text-[9px] font-mono text-muted-foreground">
                {format(ephemeris.propagatedAt, "HH:mm:ss")} UTC
              </span>
            }
          >
            <div>
              <LabelValueRow
                label="Latitude"
                value={`${ephemeris.current.lat.toFixed(4)}°`}
              />
              <LabelValueRow
                label="Longitude"
                value={`${ephemeris.current.lng.toFixed(4)}°`}
              />
              <LabelValueRow
                label="Altitude"
                value={`${ephemeris.current.alt.toFixed(1)} km`}
              />
              <LabelValueRow
                label="Speed"
                value={`${ephemeris.current.speed.toFixed(3)} km/s`}
              />
              <LabelValueRow
                label="Vx / Vy / Vz"
                value={`${ephemeris.current.vx.toFixed(2)} / ${ephemeris.current.vy.toFixed(2)} / ${ephemeris.current.vz.toFixed(2)} km/s`}
              />
              <LabelValueRow
                label="Right Ascension"
                value={`${ephemeris.current.ra.toFixed(4)}°`}
              />
              <LabelValueRow
                label="Declination"
                value={`${ephemeris.current.dec.toFixed(4)}°`}
                last
              />
            </div>
          </CollapsibleSection>
        )}

      </div>
    </>
  );
}

// ─── Inline Panel (side-by-side with Earth) ─────────────────────────────────

export function SatelliteDetailPanel({
  satellite,
  onClose,
}: SatelliteDetailPanelProps) {
  const detail = useSatelliteDetail(satellite, !!satellite);

  if (!satellite) return null;

  return (
    <div className="h-full flex flex-col bg-background">
      {onClose && (
        <div className="flex items-center justify-end p-2 border-b border-border/50">
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <SatelliteDetailContent satellite={satellite} detail={detail} />
      </div>
    </div>
  );
}
