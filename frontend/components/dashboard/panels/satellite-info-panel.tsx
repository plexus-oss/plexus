"use client";

/**
 * Satellite Info Panel
 *
 * Renders the SatelliteDetailPanel (SatCat-style card) as a dashboard panel.
 * Shows orbital elements, ground track, current state, TLE info — all
 * computed client-side from TLE data. No SQL needed.
 *
 * Supports two modes:
 * 1. Device mode: config.sourceId → fetch TLE from device metadata
 * 2. Connection mode: config.connectionId + config.tleQuery → query TLE
 *    from the database, using the $sat_id dashboard variable
 */

import { useEffect, useMemo } from "react";
import { SatelliteDetailPanel } from "@/components/dashboard/orbital/satellite-detail-sheet";
import { useSource } from "@/hooks/use-sources";
import { useOrbitalDevices } from "@/hooks/use-orbital-devices";
import { useConnectionQueryManual } from "@/hooks/use-connection-query";
import { useDashboardVariables } from "@/components/dashboard/dashboard-state-context";
import type { Satellite } from "@/lib/db/types";
import type { Panel } from "@/lib/types/dashboard";

interface SatelliteInfoPanelProps {
  panel: Panel;
}

export function SatelliteInfoPanel({ panel }: SatelliteInfoPanelProps) {
  const sourceId = panel.config.sourceId as string | undefined;
  const connectionId = panel.config.connectionId as string | undefined;
  const tleQuery = panel.config.tleQuery as string | undefined;

  const { values: variableValues } = useDashboardVariables();
  const satId = variableValues.sat_id;

  // ─── Device mode: fetch from source metadata ────────────────────────────
  const { source } = useSource(sourceId ?? null);

  const deviceSatellite = useMemo((): Satellite | null => {
    if (!source) return null;
    const meta = source.metadata as Record<string, unknown> | null;
    if (!meta) return null;

    return {
      id: source.id,
      source_id: source.id,
      name: source.name || source.slug,
      norad_id: meta.norad_id ? Number(meta.norad_id) : null,
      color: (meta.color as string) || "#3b82f6",
      tle_line1: (meta.tle_line1 as string) || null,
      tle_line2: (meta.tle_line2 as string) || null,
      tle_epoch: (meta.tle_epoch as string) || null,
      tle_fetched_at: (meta.tle_fetched_at as string) || null,
      metadata: meta,
      slug: source.slug,
    } as unknown as Satellite;
  }, [source]);

  // Device-mode TLEs live in sources.metadata with no background refresher
  // (the update-tles cron was removed) — refresh stale ones on open, same
  // 7-day gate as the earth panel.
  const { refreshTles } = useOrbitalDevices();
  useEffect(() => {
    if (!deviceSatellite) return;
    const epoch = deviceSatellite.tle_epoch;
    const stale = !epoch || Date.now() - new Date(epoch).getTime() > 7 * 86400000;
    if (stale) refreshTles().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceSatellite?.id]);

  // ─── Connection mode: query TLE using pre-built query + $sat_id ─────────
  const executor = useConnectionQueryManual(connectionId ?? null);

  useEffect(() => {
    if (!connectionId || !tleQuery || !satId) return;
    // Substitute $sat_id in the pre-built query
    const sql = tleQuery.replace(
      /\$sat_id(?![\w])/g,
      satId.replace(/'/g, "''"),
    );
    executor.execute(sql);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, tleQuery, satId]);

  const connectionSatellite = useMemo((): Satellite | null => {
    if (!connectionId || !satId || executor.rows.length === 0) return null;
    const row = executor.rows[0] as Record<string, unknown>;

    return {
      id: `sat-${satId}`,
      org_id: "",
      norad_id: Number(satId),
      name: `Satellite ${satId}`,
      official_name: null,
      color: "#3b82f6",
      group_name: null,
      tle_line1: (row.line1 as string) || null,
      tle_line2: (row.line2 as string) || null,
      tle_epoch: (row.epoch as string) || null,
      tle_fetched_at: null,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } satisfies Satellite;
  }, [connectionId, satId, executor.rows]);

  // Prefer device mode, fall back to connection mode
  const satellite = deviceSatellite || connectionSatellite;

  if (!sourceId && !connectionId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Configure a satellite source or connection in panel settings
      </div>
    );
  }

  if (!satellite) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {executor.isLoading ? "Loading satellite..." : satId ? "No TLE data found" : "Select a satellite"}
      </div>
    );
  }

  return (
    <SatelliteDetailPanel satellite={satellite} />
  );
}
