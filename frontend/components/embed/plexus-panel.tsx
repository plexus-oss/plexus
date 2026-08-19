"use client";

/**
 * <PlexusPanel> — the embeddable panel. A customer drops this into their own
 * React app with an embed token; it fetches exactly one panel's data from the
 * embed data plane (/api/embed/panel) and renders it with the same shared
 * <PanelChart> core the Plexus product uses — so it inherits pan/zoom (2d) and
 * the built-in hover tooltip, with no Plexus login and no provider pyramid.
 *
 * Pan/zoom uses the product's time-window model: the chart's x-axis spans the
 * selected time range, a shift-drag / scroll zoom previews instantly (local
 * viewWindow → xAxis domain) and commits by refetching that window from the
 * embed route; double-click resets to the original range.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PanelChart,
  makeTimeFormatter,
} from "@/components/panel/panel-chart";
import { getTimeRangeBounds, type TimeRange } from "@/lib/types/dashboard";
import type { ViewWindow } from "@/components/dashboard/dashboard-interaction-context";
import type { UnifiedSeries } from "@/components/ui/charts/unified-renderer";
import { Spinner } from "@/components/ui/spinner";

export interface EmbedPanelPoint {
  timestamp: string;
  value: number;
  source_id: string;
}

export interface EmbedPanelResponse {
  panel: { id: string; type: string; title: string };
  data: Record<string, EmbedPanelPoint[]>;
}

export interface PlexusPanelProps {
  /** The only required prop — it encodes the org, dashboard, and panel. */
  token: string;
  /** Origin of the Plexus app; defaults to the hosted app. Override for staging. */
  apiBase?: string;
  /** Optional; the token already identifies the panel. Pass only to pin/verify. */
  dashboardId?: string;
  panelId?: string;
  /** Relative ("24h") or ISO range; defaults to the panel's configured range. */
  timeRange?: string;
  colors?: string[];
  height?: number | string;
  refreshMs?: number;
  className?: string;
}

const DEFAULT_API_BASE = "https://app.plexus.company";

/** Chart plot margin — matches UnifiedChart's default so pan/zoom geometry lines up. */
const MARGIN = { top: 20, right: 20, bottom: 50, left: 60 };

/** Tooltip time format: always precise (day + time, or seconds when zoomed in). */
function makeTooltipFormatter(spanMs: number): (ms: number) => string {
  const DAY = 86_400_000;
  const opts: Intl.DateTimeFormatOptions =
    spanMs > DAY
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : spanMs > 90 * 60_000
        ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
        : { hour: "2-digit", minute: "2-digit", second: "2-digit" };
  const fmt = new Intl.DateTimeFormat(undefined, opts);
  return (ms: number) => fmt.format(new Date(ms));
}

function parseRange(value: string | undefined): TimeRange {
  const v = value ?? "24h";
  if (/^\d+[smhd]$/.test(v)) return { type: "relative", value: v };
  if (v.includes("/")) return { type: "absolute", value: v };
  return { type: "relative", value: "24h" };
}

/** Turn the embed API's per-key point arrays into UnifiedChart series. Pure. */
export function embedDataToSeries(
  data: Record<string, EmbedPanelPoint[]>,
  colors?: string[],
): UnifiedSeries[] {
  return Object.entries(data).map(([key, points], i) => ({
    name: key,
    color: colors?.[i],
    data: points
      .map((p) => ({ x: Date.parse(p.timestamp), y: p.value }))
      .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y)),
  }));
}

export function PlexusPanel({
  token,
  dashboardId,
  panelId,
  apiBase = DEFAULT_API_BASE,
  timeRange,
  colors,
  height = 320,
  refreshMs,
  className,
}: PlexusPanelProps) {
  // A committed zoom overrides the prop range; null = follow the prop. Derived
  // (no effect) so changing the `timeRange` prop takes effect automatically.
  const [zoomRange, setZoomRange] = useState<string | null>(null);
  const activeRange = zoomRange ?? timeRange ?? "24h";
  // Instant zoom preview before the committed refetch lands.
  const [viewWindow, setViewWindow] = useState<ViewWindow | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; result: EmbedPanelResponse }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const url = new URL(`${apiBase}/api/embed/panel`, window.location.origin);
        // The token identifies the panel; ids are optional (pin/verify only).
        if (dashboardId) url.searchParams.set("dashboardId", dashboardId);
        if (panelId) url.searchParams.set("panelId", panelId);
        url.searchParams.set("timeRange", activeRange);
        const res = await fetch(url.toString(), {
          headers: { "x-embed-token": token },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        const result = (await res.json()) as EmbedPanelResponse;
        if (!cancelled) setState({ status: "ready", result });
      } catch (err) {
        if (!cancelled)
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load panel",
          });
      }
    };
    load();
    // Poll only when the tab is visible, and never faster than 5s — so an
    // off-screen or backgrounded embed stops spending requests, and an
    // aggressive refreshMs can't hammer the rate limit. Refetch on regaining
    // visibility so the viewer sees fresh data on return.
    const interval = refreshMs && refreshMs > 0 ? Math.max(refreshMs, 5000) : 0;
    let id: ReturnType<typeof setInterval> | undefined;
    const onVisible = () => {
      if (!document.hidden) load();
    };
    if (interval > 0) {
      id = setInterval(() => {
        if (!document.hidden) load();
      }, interval);
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, dashboardId, panelId, apiBase, activeRange, refreshMs]);

  const series = useMemo(
    () =>
      state.status === "ready"
        ? embedDataToSeries(state.result.data, colors)
        : [],
    [state, colors],
  );
  const hasData = series.some((s) => s.data.length > 0);

  const rangeObj = useMemo(() => parseRange(activeRange), [activeRange]);
  const xDomain = useMemo<[number, number]>(() => {
    if (viewWindow) return [viewWindow.start, viewWindow.end];
    const { start, end } = getTimeRangeBounds(rangeObj);
    return [start.getTime(), end.getTime()];
  }, [viewWindow, rangeObj]);
  // Axis keeps the day-based formatter; the tooltip gets a finer one so hovering
  // shows the exact moment (day + time), not just the day.
  const formatter = useMemo(
    () => makeTimeFormatter(xDomain[1] - xDomain[0]),
    [xDomain],
  );
  const tooltipFormatter = useMemo(
    () => makeTooltipFormatter(xDomain[1] - xDomain[0]),
    [xDomain],
  );

  // Render the panel's real chart type (line/area/bar/scatter); other types
  // fall back to line for now.
  const chartType: "line" | "area" | "bar" | "scatter" =
    state.status === "ready" &&
    (["line", "area", "bar", "scatter"] as const).includes(
      state.result.panel.type as "line",
    )
      ? (state.result.panel.type as "line" | "area" | "bar" | "scatter")
      : "line";

  const observerRef = useRef<ResizeObserver | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    const r = node.getBoundingClientRect();
    setSize({ width: r.width, height: r.height });
    const obs = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setSize({ width: e.contentRect.width, height: e.contentRect.height });
    });
    obs.observe(node);
    observerRef.current = obs;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  const innerWidth = Math.max(0, size.width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, size.height - MARGIN.top - MARGIN.bottom);

  return (
    <div
      className={className}
      style={{ height, width: "100%", position: "relative" }}
    >
      {state.status === "loading" ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : state.status === "error" ? (
        <Centered>
          <span style={{ fontSize: 13, opacity: 0.7 }}>{state.message}</span>
        </Centered>
      ) : !hasData ? (
        <Centered>
          <span style={{ fontSize: 13, opacity: 0.7 }}>No data in this range</span>
        </Centered>
      ) : (
        <PanelChart
          type={chartType}
          series={series}
          readOnly
          margin={MARGIN}
          xAxis={{ type: "time", domain: xDomain, formatter, tooltipFormatter }}
          containerRef={containerRef}
          geometry={{ xDomain, innerWidth, innerHeight, chartSize: size, formatter }}
          panZoom={{
            timeRange: rangeObj,
            enabled: true,
            setViewWindow,
            onTimeRangeChange: (start, end) => {
              setZoomRange(
                `${new Date(start).toISOString()}/${new Date(end).toISOString()}`,
              );
              setViewWindow(null);
            },
            onTimeRangeReset: () => {
              setZoomRange(null);
              setViewWindow(null);
            },
          }}
        />
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  );
}
