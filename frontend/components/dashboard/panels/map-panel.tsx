"use client";

/**
 * Map Panel — MapLibre GL basemap with live vehicle tracking.
 *
 * Replaces the former react-simple-maps SVG renderer with real tile
 * imagery (OSM by default; swap to MapTiler/Mapbox via env). Keeps the
 * same panel config contract:
 *   centerLat / centerLng / zoom  — initial view
 *   vehicles[] { sourceSlug, label, color, latMetric, lngMetric }
 *   latMetric / lngMetric         — single-source fallback
 *   showPath, pathColor, markerColor, coordinateFormat
 *   lat/lng/label/state/stateColors columns — connection-row markers mode
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import maplibregl, {
  Map as MapLibreMap,
  Marker,
  LngLatLike,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { usePanelData } from "@/hooks/use-panel-data";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { PanelEmptyState } from "@/components/dashboard/panels/panel-empty-state";
import { Locate, RotateCcw } from "lucide-react";

interface MapPanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

interface VehicleConfig {
  sourceSlug: string;
  label: string;
  color: string;
  latMetric: string;
  lngMetric: string;
}

interface MapConfig {
  centerLat?: number;
  centerLng?: number;
  zoom?: number;
  latMetric?: string;
  lngMetric?: string;
  showPath?: boolean;
  pathColor?: string;
  markerColor?: string;
  coordinateFormat?: "decimal" | "dms";
  vehicles?: VehicleConfig[];
  latColumn?: string;
  lngColumn?: string;
  labelColumn?: string;
  stateColumn?: string;
  stateColors?: Record<string, string>;
  /** Optional tile style; defaults to OSM raster. Set to a MapLibre style
   *  URL (MapTiler, Stadia, Mapbox) for production imagery. */
  tileStyle?: string;
}

interface MapPoint {
  lat: number;
  lng: number;
  timestamp: string;
}

interface VehicleTrack {
  id: string;
  label: string;
  color: string;
  points: MapPoint[];
}

interface MarkerPin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color: string;
  state: string;
}

const VEHICLE_COLORS = [
  "hsl(210, 100%, 56%)",
  "hsl(142, 71%, 45%)",
  "hsl(38, 92%, 50%)",
  "hsl(0, 84%, 60%)",
  "hsl(280, 67%, 54%)",
  "hsl(190, 90%, 50%)",
];

const DEFAULT_STATE_COLORS: Record<string, string> = {
  running: "hsl(142, 71%, 45%)",
  ok: "hsl(142, 71%, 45%)",
  active: "hsl(142, 71%, 45%)",
  online: "hsl(142, 71%, 45%)",
  healthy: "hsl(142, 71%, 45%)",
  charging: "hsl(210, 100%, 56%)",
  idle: "hsl(210, 100%, 56%)",
  warning: "hsl(38, 92%, 50%)",
  pending: "hsl(38, 92%, 50%)",
  degraded: "hsl(38, 92%, 50%)",
  alerting: "hsl(0, 84%, 60%)",
  error: "hsl(0, 84%, 60%)",
  critical: "hsl(0, 84%, 60%)",
  offline: "hsl(220, 9%, 55%)",
  unknown: "hsl(220, 9%, 55%)",
};

function firstColumnMap(
  cols: string[] | undefined,
  candidates: string[],
): string | null {
  if (!cols) return null;
  for (const c of candidates) if (cols.includes(c)) return c;
  return null;
}

function toDMS(decimal: number, isLat: boolean): string {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = ((minFloat - min) * 60).toFixed(1);
  const dir = isLat ? (decimal >= 0 ? "N" : "S") : decimal >= 0 ? "E" : "W";
  return `${deg}°${min}'${sec}"${dir}`;
}

function extractPoints(
  data: Record<string, Array<{ timestamp: string; value: unknown }>>,
  latKey: string,
  lngKey: string,
): MapPoint[] {
  const latData = data[latKey];
  const lngData = data[lngKey];
  if (!latData || !lngData) return [];

  const byTs = new Map<string, Partial<MapPoint>>();
  for (const p of latData) {
    const v =
      typeof p.value === "number" ? p.value : parseFloat(String(p.value));
    if (Number.isFinite(v))
      byTs.set(p.timestamp, { ...byTs.get(p.timestamp), lat: v });
  }
  for (const p of lngData) {
    const v =
      typeof p.value === "number" ? p.value : parseFloat(String(p.value));
    if (Number.isFinite(v))
      byTs.set(p.timestamp, { ...byTs.get(p.timestamp), lng: v });
  }

  const out: MapPoint[] = [];
  for (const [timestamp, { lat, lng }] of byTs) {
    if (lat !== undefined && lng !== undefined) {
      out.push({ lat, lng, timestamp });
    }
  }
  return out.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

/** Dark basemap: CARTO "Dark Matter" — free, no API key, cleanly
 *  styled for dark-mode dashboards. Includes the required attribution. */
const CARTO_DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    "carto-dark": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors, © <a href="https://carto.com/attributions">CARTO</a>',
      maxzoom: 20,
    },
  },
  layers: [{ id: "carto-dark", type: "raster", source: "carto-dark" }],
};

/** Light fallback: CARTO "Positron" — matched styling for light mode. */
const CARTO_LIGHT_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    "carto-light": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors, © <a href="https://carto.com/attributions">CARTO</a>',
      maxzoom: 20,
    },
  },
  layers: [{ id: "carto-light", type: "raster", source: "carto-light" }],
};

export function MapPanel({ panel, timeRange }: MapPanelProps) {
  const config = panel.config as unknown as MapConfig;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRefsRef = useRef<Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [follow, setFollow] = useState(true);

  const { data, isLoading, error, sourceType, refresh, connectionMeta } =
    usePanelData({ panel, timeRange });

  const useConnection = sourceType === "connection";
  const connectionRows = useMemo(
    () => connectionMeta?.rows ?? [],
    [connectionMeta],
  );
  const connectionColumns = useMemo(
    () => connectionMeta?.columns ?? [],
    [connectionMeta],
  );

  // ── Markers (connection-row mode) ─────────────────────────────────────
  const connectionMarkers = useMemo<MarkerPin[]>(() => {
    if (!useConnection || connectionRows.length === 0) return [];
    const colNames = connectionColumns.map((c) => c.name);
    const latCol =
      config.latColumn ?? firstColumnMap(colNames, ["lat", "latitude"]);
    const lngCol =
      config.lngColumn ?? firstColumnMap(colNames, ["lng", "lon", "longitude"]);
    const labelCol =
      config.labelColumn ??
      firstColumnMap(colNames, ["name", "slug", "id", "label"]);
    const stateCol =
      config.stateColumn ?? firstColumnMap(colNames, ["state", "status"]);
    if (!latCol || !lngCol) return [];

    const stateColors = {
      ...DEFAULT_STATE_COLORS,
      ...(config.stateColors ?? {}),
    };
    const defaultColor = config.markerColor ?? "hsl(210, 100%, 56%)";

    return connectionRows
      .map((row, i): MarkerPin | null => {
        const lat = Number(row[latCol]);
        const lng = Number(row[lngCol]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const state = stateCol ? String(row[stateCol] ?? "").toLowerCase() : "";
        const label = labelCol ? String(row[labelCol] ?? "") : "";
        return {
          id: labelCol ? String(row[labelCol] ?? `row-${i}`) : `row-${i}`,
          lat,
          lng,
          label,
          state,
          color: stateColors[state] ?? defaultColor,
        };
      })
      .filter((m): m is MarkerPin => m !== null);
  }, [useConnection, connectionRows, connectionColumns, config]);

  // ── Vehicle tracks (realtime metric mode) ─────────────────────────────
  const vehicles = useMemo<VehicleTrack[]>(() => {
    if (!data) return [];

    if (config.vehicles && config.vehicles.length > 0) {
      return config.vehicles.map((v, i) => ({
        id: v.sourceSlug,
        label: v.label,
        color: v.color || VEHICLE_COLORS[i % VEHICLE_COLORS.length],
        points: extractPoints(data, v.latMetric, v.lngMetric),
      }));
    }

    // Auto-detect lat/lng metrics per source
    const metrics = panel.metrics || [];
    const bySource = new Map<string, { lats: string[]; lngs: string[] }>();
    for (const m of metrics) {
      const i = m.indexOf(":");
      if (i === -1) continue;
      const source = m.substring(0, i);
      const metric = m.substring(i + 1);
      const entry = bySource.get(source) || { lats: [], lngs: [] };
      if (/lat/i.test(metric)) entry.lats.push(m);
      if (/lng|lon/i.test(metric)) entry.lngs.push(m);
      bySource.set(source, entry);
    }

    if (bySource.size >= 1) {
      const tracks: VehicleTrack[] = [];
      let colorIdx = 0;
      for (const [source, { lats, lngs }] of bySource) {
        if (lats.length > 0 && lngs.length > 0) {
          tracks.push({
            id: source,
            label: source,
            color: VEHICLE_COLORS[colorIdx % VEHICLE_COLORS.length],
            points: extractPoints(data, lats[0], lngs[0]),
          });
          colorIdx++;
        }
      }
      if (tracks.length > 0) return tracks;
    }

    const latMetric = config.latMetric || metrics[0] || "latitude";
    const lngMetric = config.lngMetric || metrics[1] || "longitude";
    const points = extractPoints(data, latMetric, lngMetric);
    if (points.length === 0) return [];
    return [
      {
        id: "default",
        label: "",
        color: config.pathColor || "hsl(210, 100%, 56%)",
        points,
      },
    ];
  }, [data, config, panel.metrics]);

  const latestPoints = useMemo(
    () =>
      vehicles
        .map((v) =>
          v.points.length > 0
            ? { ...v, latest: v.points[v.points.length - 1] }
            : null,
        )
        .filter((v): v is VehicleTrack & { latest: MapPoint } => v !== null),
    [vehicles],
  );

  const coordinateFormat = config.coordinateFormat || "decimal";
  const formatCoord = useCallback(
    (lat: number, lng: number) =>
      coordinateFormat === "dms"
        ? `${toDMS(lat, true)} ${toDMS(lng, false)}`
        : `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    [coordinateFormat],
  );

  // ── Map lifecycle ─────────────────────────────────────────────────────
  //
  // Two-phase init to defeat the "top 1/6" symptom: dashboard grid panels
  // mount with a 0×0 container for the first few frames (Next/Grid-Layout
  // measures on the second pass). If we create the MapLibre Map before the
  // container has dimensions, it locks its canvas at that initial size and
  // calling resize() later scales the canvas but leaves the GL viewport
  // and zoom geometry tied to the 0×0 inception.
  //
  // Approach:
  //   1. ResizeObserver watches the container.
  //   2. First non-zero size → create the Map.
  //   3. Subsequent size changes → map.resize().
  //   4. Use requestAnimationFrame to coalesce during drag/resize.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId = 0;
    let resizeRafId = 0;

    const buildMap = () => {
      if (mapRef.current) return;

      const explicit = config.tileStyle as unknown as
        | string
        | maplibregl.StyleSpecification
        | undefined;
      let styleSpec: string | maplibregl.StyleSpecification;
      if (explicit) {
        styleSpec = explicit;
      } else {
        const isDark =
          typeof document !== "undefined" &&
          (document.documentElement.classList.contains("dark") ||
            window.matchMedia?.("(prefers-color-scheme: dark)").matches);
        styleSpec = isDark ? CARTO_DARK_STYLE : CARTO_LIGHT_STYLE;
      }

      const map = new maplibregl.Map({
        container,
        style: styleSpec,
        center: [config.centerLng ?? 0, config.centerLat ?? 20],
        zoom: config.zoom ?? 4,
        attributionControl: { compact: true },
      });
      mapRef.current = map;

      map.on("load", () => {
        // Belt-and-suspenders: one more resize after load, in case the
        // container grew between buildMap() and the first render. Then
        // triggerRepaint forces MapLibre to re-request tiles for the
        // new viewport — without it, a resize that grows the map keeps
        // rendering only the tiles requested for the initial small box.
        map.resize();
        map.triggerRepaint();
        // A second RAF-scheduled resize catches the case where the
        // browser applies scrollbar/layout adjustments after load.
        requestAnimationFrame(() => {
          map.resize();
          map.triggerRepaint();
        });
        setMapReady(true);
      });
      map.on("dragstart", () => setFollow(false));
      map.on("zoomstart", (e) => {
        if (e.originalEvent) setFollow(false);
      });
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;

      if (!mapRef.current) {
        // First non-zero size — safe to create the map now.
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(buildMap);
      } else {
        // Already built — just resize on subsequent changes, then
        // triggerRepaint so MapLibre refetches tiles for the new
        // viewport dimensions.
        cancelAnimationFrame(resizeRafId);
        resizeRafId = requestAnimationFrame(() => {
          if (mapRef.current) {
            mapRef.current.resize();
            mapRef.current.triggerRepaint();
          }
        });
      }
    });
    observer.observe(container);

    // Cover the case where the container already had a size at mount
    // time (no observer entry fires for existing dimensions on some
    // browsers until the next layout tick).
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      rafId = requestAnimationFrame(buildMap);
    }

    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(resizeRafId);
      observer.disconnect();
      for (const m of markerRefsRef.current) m.remove();
      markerRefsRef.current = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // one-time; config changes propagate via the other effects

  // ── Draw connection markers ───────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !useConnection) return;

    for (const pin of connectionMarkers) {
      const el = document.createElement("div");
      el.className = "plx-map-pin";
      el.style.cssText = `width:6px;height:6px;border-radius:50%;background:${pin.color};box-shadow:0 0 0 1.25px rgba(255,255,255,0.85),0 1px 3px rgba(0,0,0,0.4);cursor:pointer;`;
      el.title = pin.label
        ? `${pin.label}\n${formatCoord(pin.lat, pin.lng)}`
        : formatCoord(pin.lat, pin.lng);
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map);
      markerRefsRef.current.push(marker);
    }

    // Fit bounds on first load
    if (connectionMarkers.length > 0 && follow) {
      const bounds = new maplibregl.LngLatBounds();
      for (const p of connectionMarkers) bounds.extend([p.lng, p.lat]);
      map.fitBounds(bounds, { padding: 50, maxZoom: 10, duration: 400 });
    }

    // Own the markers we created: removed before the next run, on mode switch,
    // and on unmount (marker.remove() also detaches the element + its listeners).
    return () => {
      for (const m of markerRefsRef.current) m.remove();
      markerRefsRef.current = [];
    };
  }, [mapReady, useConnection, connectionMarkers, follow, formatCoord]);

  // ── Draw vehicle tracks ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || useConnection) return;

    const showPath = config.showPath !== false;
    const maxTrailPoints = 500;

    // Build a single FeatureCollection with one LineString per vehicle
    const features = vehicles
      .filter((v) => v.points.length > 1)
      .map((v) => {
        const pts = v.points.slice(-maxTrailPoints);
        return {
          type: "Feature" as const,
          properties: { id: v.id, color: v.color, label: v.label },
          geometry: {
            type: "LineString" as const,
            coordinates: pts.map((p) => [p.lng, p.lat] as [number, number]),
          },
        };
      });

    const geojson = {
      type: "FeatureCollection" as const,
      features,
    };

    const sourceId = "vehicle-tracks";
    const existing = map.getSource(sourceId) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (existing) {
      existing.setData(geojson);
    } else {
      map.addSource(sourceId, { type: "geojson", data: geojson });
      map.addLayer({
        id: "vehicle-track-line",
        type: "line",
        source: sourceId,
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#3b82f6"],
          "line-width": 3,
          "line-opacity": showPath ? 0.85 : 0,
        },
        layout: { "line-join": "round", "line-cap": "round" },
      });
    }
    // Toggle track visibility if showPath changed
    if (map.getLayer("vehicle-track-line")) {
      map.setPaintProperty(
        "vehicle-track-line",
        "line-opacity",
        showPath ? 0.85 : 0,
      );
    }

    // Latest-point markers with pulsing halo and label
    for (const v of latestPoints) {
      const el = document.createElement("div");
      el.className = "plx-map-pin";
      el.style.cssText = `position:relative;width:6px;height:6px;`;
      el.innerHTML = `
        <span style="position:absolute;inset:-3px;border-radius:50%;background:${v.color};opacity:0.25;animation:plxMapPulse 1800ms ease-out infinite;"></span>
        <span style="position:absolute;inset:0;border-radius:50%;background:${v.color};box-shadow:0 0 0 1.25px rgba(255,255,255,0.9),0 1px 3px rgba(0,0,0,0.4);"></span>
      `;
      const popup = new maplibregl.Popup({
        offset: 10,
        closeButton: false,
        className: "plx-map-popup",
      }).setHTML(
        `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.4;">
           <div style="font-weight:600;color:#111;">${v.label || v.id}</div>
           <div style="color:#555;">${formatCoord(v.latest.lat, v.latest.lng)}</div>
         </div>`,
      );
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([v.latest.lng, v.latest.lat])
        .setPopup(popup)
        .addTo(map);
      el.addEventListener("mouseenter", () => marker.togglePopup());
      el.addEventListener("mouseleave", () => marker.togglePopup());
      markerRefsRef.current.push(marker);
    }

    // Own the markers we created: removed before the next data-driven re-run,
    // on mode switch, and on unmount (marker.remove() detaches the element,
    // its mouseenter/mouseleave listeners, and the popup).
    return () => {
      for (const m of markerRefsRef.current) m.remove();
      markerRefsRef.current = [];
    };
  }, [
    mapReady,
    useConnection,
    vehicles,
    latestPoints,
    config.showPath,
    formatCoord,
  ]);

  // ── Follow mode: ease to latest point as new data arrives ────────────
  const lastCenteredRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !follow) return;

    // Multi-vehicle: fit bounds to all latest points
    if (latestPoints.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      for (const v of latestPoints) bounds.extend([v.latest.lng, v.latest.lat]);
      const key = latestPoints
        .map((v) => `${v.latest.lat.toFixed(4)},${v.latest.lng.toFixed(4)}`)
        .sort()
        .join("|");
      if (lastCenteredRef.current === key) return;
      lastCenteredRef.current = key;
      map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 500 });
      return;
    }

    if (latestPoints.length === 1) {
      const p = latestPoints[0].latest;
      const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
      if (lastCenteredRef.current === key) return;
      lastCenteredRef.current = key;
      map.easeTo({ center: [p.lng, p.lat] as LngLatLike, duration: 500 });
    }
  }, [mapReady, follow, latestPoints]);

  const handleReset = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: [config.centerLng ?? 0, config.centerLat ?? 20],
      zoom: config.zoom ?? 4,
      duration: 400,
    });
    setFollow(false);
  }, [config.centerLat, config.centerLng, config.zoom]);

  const handleToggleFollow = useCallback(() => {
    const next = !follow;
    setFollow(next);
    lastCenteredRef.current = null;
  }, [follow]);

  // ── Empty / error states ──────────────────────────────────────────────
  if (error) {
    return (
      <PanelEmptyState
        reason="query_error"
        debugInfo={{
          sourceType,
          errorMessage: error instanceof Error ? error.message : String(error),
        }}
        onRetry={refresh}
      />
    );
  }

  const showLoading =
    isLoading &&
    vehicles.every((v) => v.points.length === 0) &&
    connectionMarkers.length === 0;

  return (
    <div
      className="plx-map-root relative"
      style={{ width: "100%", height: "100%", minHeight: 0 }}
    >
      {/* Pulse keyframes + critical maplibre sizing.
          maplibre-gl.css is imported at module level, but some Next.js
          chunking paths leave it unloaded for lazy panel modules, so the
          canvas elements have no explicit sizing rules and collapse to
          their default intrinsic size (~150px tall = "top 1/6 only").
          These rules replicate the critical size selectors inline so the
          panel works regardless of whether the CSS bundle lands. */}
      <style>{`
        @keyframes plxMapPulse {
          0%   { transform: scale(1);   opacity: 0.5; }
          100% { transform: scale(2.2); opacity: 0;   }
        }
        .plx-map-popup .maplibregl-popup-content {
          padding: 6px 10px; border-radius: 6px; background: #fff;
        }
        .plx-map-popup .maplibregl-popup-tip { border-top-color: #fff; }
        /* Fallback sizing in case maplibre-gl.css is missing from the
           lazy chunk. Critical rule: never force width/height on the
           <canvas> itself — MapLibre sets canvas.style.width/height in
           CSS pixels (and canvas.width/height in device pixels) from
           map.resize(), and that size is the source of truth for its
           projection math. Overriding it with CSS desyncs tile imagery
           from the HTML marker layer (markers drift, zoom/pan stops
           reprojecting correctly). Only position the canvas; let
           MapLibre own its dimensions. */
        .plx-map-root .maplibregl-map { position: relative; width: 100%; height: 100%; overflow: hidden; }
        .plx-map-root .maplibregl-canvas-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
        .plx-map-root .maplibregl-canvas { position: absolute; top: 0; left: 0; }
        .plx-map-root .maplibregl-marker { position: absolute; top: 0; left: 0; will-change: transform; }
        /* Force MapLibre compact mode everywhere — at dashboard panel
           sizes the expanded attribution wraps and steals vertical
           space. Compact shows a small circled-i button instead; hover
           or click to expand the full OSM/CARTO attribution text.
           Required by tile providers' TOS, but keep it out of the way. */
        .plx-map-root .maplibregl-ctrl-attrib:not(.maplibregl-compact) { display: none; }
        .plx-map-root .maplibregl-ctrl-attrib.maplibregl-compact {
          padding: 0;
          margin: 6px;
          background: rgba(0, 0, 0, 0.35);
          backdrop-filter: blur(4px);
          border-radius: 999px;
        }
        .plx-map-root .maplibregl-ctrl-attrib.maplibregl-compact .maplibregl-ctrl-attrib-inner { display: none; }
        .plx-map-root .maplibregl-ctrl-attrib.maplibregl-compact.maplibregl-compact-show .maplibregl-ctrl-attrib-inner {
          display: block; padding: 2px 22px 2px 8px; font-size: 10px; color: #ddd;
        }
        .plx-map-root .maplibregl-ctrl-attrib.maplibregl-compact.maplibregl-compact-show .maplibregl-ctrl-attrib-inner a { color: #fff; }
        .plx-map-root .maplibregl-ctrl-attrib-button {
          width: 18px; height: 18px; background-size: 14px; opacity: 0.7;
        }
      `}</style>
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          // Explicit width/height too — MapLibre measures via
          // getBoundingClientRect and some Tailwind `h-full` chains
          // resolve to 0 inside flex/grid ancestors with min-height auto.
          width: "100%",
          height: "100%",
        }}
      />
      {showLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-sm pointer-events-none">
          <Spinner />
        </div>
      )}
      {/* Control pill */}
      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-md bg-background/80 backdrop-blur border border-border shadow-sm z-10">
        <button
          onClick={handleReset}
          aria-label="Reset view"
          className="p-1.5 rounded-l-md hover:bg-muted/80 transition-colors text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        {latestPoints.length > 0 && (
          <button
            onClick={handleToggleFollow}
            aria-label={follow ? "Stop following" : "Follow target"}
            className={cn(
              "p-1.5 rounded-r-md transition-colors",
              follow
                ? "text-foreground bg-muted/60"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/80",
            )}
          >
            <Locate className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
