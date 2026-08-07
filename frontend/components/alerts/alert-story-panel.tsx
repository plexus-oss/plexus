"use client";

/**
 * Alert Story Panel
 *
 * Redesigned alert detail panel with:
 * - Full-width severity color band header
 * - Big value display with threshold reference
 * - Causality timeline with staggered animations
 * - Action cards (clickable, not numbered list)
 * - Compact source context
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Play,
  Pause,
  RotateCcw as ResetIcon,
  Globe,
  Map,
  Eye,
  X,
  ExternalLink,
  FileText,
  Wrench,
  BookOpen,
  Radio,
  Satellite,
  MessageSquare,
  Zap,
  Activity,
  RotateCcw,
  ArrowRight,
  Database,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { KeyboardHint } from "@/components/ui/keyboard-hint";
import { cn } from "@/lib/utils";
import { MINUTE_MS, HOUR_MS } from "@/lib/constants/time";
import { formatDistanceToNow, format } from "date-fns";
import ReactMarkdown from "react-markdown";
import Link from "next/link";
import type {
  Alert,
  AlertEvent,
  AlertStatus,
  LimitSeverity,
  VerdictStats,
  Source,
  SourceContext,
} from "@/lib/db/types";
import { useRole } from "@/hooks/use-role";
import { useAlertStats } from "@/hooks/use-alert-stats";
import { AlertStatsCard } from "@/components/alerts/alert-stats-card";
import { PanelRenderer } from "@/components/dashboard/panel-renderer";
import { PanelErrorBoundary } from "@/components/dashboard/panel-error-boundary";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { ConjunctionGroundTrack } from "@/components/alerts/conjunction-ground-track";
import type { StateVector } from "@/lib/orbital/propagation";

// =============================================================================
// ALERT VISUALIZATION — renders a dashboard panel inside the alert detail
// =============================================================================

const SPEED_OPTIONS = [100, 250, 500, 1000, 2000] as const;

function AlertVisualization({
  alertId,
  visualization,
  triggeredAt,
  contextData,
}: {
  alertId: string;
  visualization: { panel_type: string; panel_config: Record<string, unknown> };
  triggeredAt: string;
  contextData?: Record<string, unknown>;
}) {
  // Closest approach time: base time + TTC (time to conjunction)
  // TTC is seconds from the base timestamp to closest approach
  const baseTime = contextData?.time
    ? new Date(contextData.time as string).getTime()
    : new Date(triggeredAt).getTime();
  const ttcMs = contextData?.ttc_mean
    ? parseFloat(String(contextData.ttc_mean)) * 1000
    : 0;
  const eventTime = baseTime + ttcMs;

  // View mode: 3D earth or 2D ground track
  const [viewMode, setViewMode] = useState<"earth" | "groundtrack">("earth");

  // Slider state: offset from event time in ms (±1 hour)
  // Start at "now" relative to the event, clamped to slider range
  const [timeOffset, setTimeOffset] = useState(() => {
    const nowOffset = Date.now() - eventTime;
    // If "now" is within the ±1h slider range, start there
    if (nowOffset >= -HOUR_MS && nowOffset <= HOUR_MS) return nowOffset;
    // Otherwise start 30min before the event
    return -HOUR_MS / 2;
  });
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  // Wall-clock "now" captured once at mount (drives the "Now" marker + label),
  // matching the one-time Date.now() sample used for the initial timeOffset.
  const [now] = useState(() => Date.now());
  const speed = SPEED_OPTIONS[speedIdx];
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef(0);

  // Auto-play animation
  useEffect(() => {
    if (!playing) return;
    lastFrameRef.current = performance.now();

    const tick = (now: number) => {
      const dt = now - lastFrameRef.current;
      lastFrameRef.current = now;
      setTimeOffset((prev) => {
        const next = prev + dt * speed;
        if (next >= HOUR_MS) {
          setPlaying(false);
          return HOUR_MS;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speed]);

  const currentTime = eventTime + timeOffset;

  const handleReset = useCallback(() => {
    setTimeOffset(0);
    setPlaying(false);
  }, []);

  // For earth panels, set sensible defaults and extract satellite data from context
  const extraConfig: Record<string, unknown> = {};
  if (visualization.panel_type === "earth") {
    extraConfig.showClouds = true;
    extraConfig.showAtmosphere = true;
    extraConfig.enableRotation = true;
    extraConfig.showOrbitalPaths = true;
    extraConfig.showSunLighting = true;
    extraConfig.epochOverride = currentTime;
    if (contextData) {
      // Check if state vectors are provided (high accuracy path)
      const hasStateVectors =
        contextData.x1 != null &&
        contextData.y1 != null &&
        contextData.z1 != null &&
        contextData.vx1 != null &&
        contextData.vy1 != null &&
        contextData.vz1 != null;

      if (hasStateVectors) {
        // Use state vectors for high-fidelity propagation
        extraConfig.stateVectors = [
          {
            x: Number(contextData.x1),
            y: Number(contextData.y1),
            z: Number(contextData.z1),
            vx: Number(contextData.vx1),
            vy: Number(contextData.vy1),
            vz: Number(contextData.vz1),
            epoch: baseTime,
            id: String(contextData.sat_id_1 ?? "sat-1"),
            color: "#f43f5e",
          },
          ...(contextData.x2 != null
            ? [
                {
                  x: Number(contextData.x2),
                  y: Number(contextData.y2),
                  z: Number(contextData.z2),
                  vx: Number(contextData.vx2),
                  vy: Number(contextData.vy2),
                  vz: Number(contextData.vz2),
                  epoch: baseTime,
                  id: String(contextData.sat_id_2 ?? "sat-2"),
                  color: "#3b82f6",
                },
              ]
            : []),
        ];
      } else {
        // Fallback: use NORAD IDs to look up satellites from the catalog (TLE-based)
        const noradIds: string[] = [];
        if (contextData.sat_id_1) noradIds.push(String(contextData.sat_id_1));
        if (contextData.sat_id_2) noradIds.push(String(contextData.sat_id_2));
        if (noradIds.length > 0) extraConfig.noradIds = noradIds;
      }
    }
  }

  const panel: Panel = {
    id: `alert-viz-${alertId}`,
    type: visualization.panel_type as Panel["type"],
    title: "",
    metrics: [],
    config: {
      ...visualization.panel_config,
      ...extraConfig,
      _alertContext: true,
    } as Panel["config"],
    layout: { x: 0, y: 0, w: 24, h: 8 },
  };

  const timeRange: TimeRange = {
    type: "relative",
    value: "1h",
  };

  // Format time offset as human-readable
  const offsetSec = Math.round(timeOffset / 1000);
  const absOffsetSec = Math.abs(offsetSec);
  const hours = Math.floor(absOffsetSec / 3600);
  const minutes = Math.floor((absOffsetSec % 3600) / 60);
  const seconds = absOffsetSec % 60;
  const relativeLabel =
    Math.abs(timeOffset) < 1000
      ? "Closest approach"
      : `${timeOffset < 0 ? "" : "+"}${hours > 0 ? `${hours}h ` : ""}${minutes}m ${seconds}s ${timeOffset < 0 ? "before" : "after"}`;
  const absoluteLabel =
    new Date(currentTime).toISOString().slice(11, 19) + " UTC";

  // Extract conjunction context for labels
  const isEarth = visualization.panel_type === "earth";
  const ttcMean = contextData?.ttc_mean
    ? parseFloat(String(contextData.ttc_mean))
    : null;
  const drMean = contextData?.dr_mean
    ? parseFloat(String(contextData.dr_mean))
    : null;

  // Format TTC as human-readable
  const ttcLabel = (() => {
    if (ttcMean == null) return null;
    const absSec = Math.abs(ttcMean);
    if (absSec < 60) return `${absSec.toFixed(1)}s`;
    if (absSec < 3600)
      return `${Math.floor(absSec / 60)}m ${Math.round(absSec % 60)}s`;
    if (absSec < 86400)
      return `${Math.floor(absSec / 3600)}h ${Math.floor((absSec % 3600) / 60)}m`;
    return `${(absSec / 86400).toFixed(1)} days`;
  })();
  const closestApproachLabel = eventTime
    ? new Date(eventTime).toISOString().replace("T", " ").slice(0, 19) + " UTC"
    : null;

  // Extract norad IDs and state vectors for ground track
  const groundTrackNoradIds = (() => {
    if (!contextData) return undefined;
    const ids: string[] = [];
    if (contextData.sat_id_1) ids.push(String(contextData.sat_id_1));
    if (contextData.sat_id_2) ids.push(String(contextData.sat_id_2));
    return ids.length > 0 ? ids : undefined;
  })();

  return (
    <div className="space-y-0">
      {/* View toggle for earth panels */}
      {isEarth && (
        <div className="flex items-center gap-1 mb-2">
          <button
            type="button"
            onClick={() => setViewMode("earth")}
            className={cn(
              "h-7 px-2.5 rounded text-[10px] font-medium flex items-center gap-1.5 transition-colors",
              viewMode === "earth"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Globe className="h-3 w-3" />
            3D
          </button>
          <button
            type="button"
            onClick={() => setViewMode("groundtrack")}
            className={cn(
              "h-7 px-2.5 rounded text-[10px] font-medium flex items-center gap-1.5 transition-colors",
              viewMode === "groundtrack"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Map className="h-3 w-3" />
            Ground Track
          </button>
        </div>
      )}

      <div
        className="rounded-lg border border-border/50 overflow-hidden"
        style={{ height: viewMode === "groundtrack" ? "auto" : 400 }}
      >
        {viewMode === "earth" ? (
          <PanelErrorBoundary panelId={panel.id} panelType={panel.type}>
            <PanelRenderer panel={panel} timeRange={timeRange} />
          </PanelErrorBoundary>
        ) : (
          <div className="p-3">
            <ConjunctionGroundTrack
              noradIds={groundTrackNoradIds}
              stateVectors={
                extraConfig.stateVectors as
                  | Array<StateVector & { id: string; color: string }>
                  | undefined
              }
              propagationTime={currentTime}
              eventTime={eventTime}
            />
          </div>
        )}
      </div>

      {/* Time scrubber — only for earth panels with a known event time */}
      {isEarth && (
        <div className="px-3 py-3 space-y-2 bg-muted/20 rounded-b-lg border border-t-0 border-border/50">
          {/* Conjunction info bar */}
          {(ttcMean != null || drMean != null || closestApproachLabel) && (
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground pb-1 flex-wrap">
              {closestApproachLabel && (
                <span>
                  Closest approach:{" "}
                  <span className="font-mono font-medium text-foreground">
                    {closestApproachLabel}
                  </span>
                </span>
              )}
              {drMean != null && (
                <span>
                  Miss distance:{" "}
                  <span className="font-mono font-medium text-foreground">
                    {drMean.toFixed(1)} m
                  </span>
                </span>
              )}
              {ttcLabel && (
                <span>
                  TTC:{" "}
                  <span className="font-mono font-medium text-foreground">
                    {ttcLabel}
                  </span>
                </span>
              )}
            </div>
          )}

          {/* Slider */}
          <div
            className="relative h-6 flex items-center group cursor-pointer select-none"
            onPointerDown={(e) => {
              const el = e.currentTarget;
              const rect = el.getBoundingClientRect();
              const update = (clientX: number) => {
                const pct = Math.max(
                  0,
                  Math.min(1, (clientX - rect.left) / rect.width),
                );
                setTimeOffset(-HOUR_MS + pct * 2 * HOUR_MS);
                setPlaying(false);
              };
              update(e.clientX);
              const onMove = (ev: PointerEvent) => update(ev.clientX);
              const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
              };
              window.addEventListener("pointermove", onMove);
              window.addEventListener("pointerup", onUp);
            }}
          >
            {/* Track */}
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-border/60" />
            {/* Fill */}
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-foreground/30 transition-[width] duration-75 ease-out"
              style={{
                width: `${((timeOffset + HOUR_MS) / (2 * HOUR_MS)) * 100}%`,
              }}
            />
            {/* Center marker for closest approach */}
            <div
              className="absolute w-px h-2.5 bg-muted-foreground/40 pointer-events-none"
              style={{ left: "50%" }}
              title="Closest approach"
            />
            {/* "Now" marker */}
            {(() => {
              const nowOffset = now - eventTime;
              const pct = ((nowOffset + HOUR_MS) / (2 * HOUR_MS)) * 100;
              if (pct < 0 || pct > 100) return null;
              return (
                <div
                  className="absolute pointer-events-none flex flex-col items-center"
                  style={{
                    left: `${pct}%`,
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <div className="w-px h-2.5 bg-emerald-500/60" />
                  <span className="text-[8px] text-emerald-500/60 font-medium mt-px">
                    Now
                  </span>
                </div>
              );
            })()}
            {/* Thumb */}
            <div
              className="absolute w-3 h-3 rounded-full bg-foreground shadow-sm border-2 border-background transition-transform duration-75 ease-out group-hover:scale-110"
              style={{
                left: `${((timeOffset + HOUR_MS) / (2 * HOUR_MS)) * 100}%`,
                transform: "translate(-50%, -50%)",
                top: "50%",
              }}
            />
          </div>

          {/* Labels under slider */}
          <div className="flex items-center justify-between text-[9px] text-muted-foreground/60">
            <span>-1h</span>
            <span className="text-red-400/80">Closest approach</span>
            <span>+1h</span>
          </div>
          {/* Show when the event is relative to now */}
          {(() => {
            const diff = now - eventTime;
            const absDiff = Math.abs(diff);
            if (absDiff < MINUTE_MS)
              return (
                <div className="text-[9px] text-green-400 text-center">
                  Happening now
                </div>
              );
            const h = Math.floor(absDiff / HOUR_MS);
            const m = Math.floor((absDiff % HOUR_MS) / MINUTE_MS);
            const label = h > 0 ? `${h}h ${m}m` : `${m}m`;
            return (
              <div className="text-[9px] text-muted-foreground/60 text-center">
                Closest approach{" "}
                {diff > 0 ? `was ${label} ago` : `is in ${label}`}
                {absDiff > HOUR_MS && " — showing simulated time"}
              </div>
            );
          })()}

          {/* Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPlaying(!playing)}
                className="h-6 w-6 rounded flex items-center justify-center hover:bg-accent transition-colors"
              >
                {playing ? (
                  <Pause className="h-3 w-3" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="h-6 w-6 rounded flex items-center justify-center hover:bg-accent transition-colors"
                title="Jump to closest approach"
              >
                <ResetIcon className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setSpeedIdx((i) => (i + 1) % SPEED_OPTIONS.length)
                }
                className="h-6 px-1.5 rounded text-[10px] font-mono font-medium hover:bg-accent transition-colors"
              >
                {speed}x
              </button>
            </div>

            <div className="flex items-center gap-3 text-[10px]">
              <span className="font-mono text-muted-foreground">
                {absoluteLabel}
              </span>
              <span
                className={cn(
                  "font-medium",
                  Math.abs(timeOffset) < 1000
                    ? "text-red-400"
                    : "text-foreground",
                )}
              >
                {relativeLabel}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// CONSTANTS
// =============================================================================

const SEVERITY_CONFIG = {
  critical: {
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    dot: "bg-red-500",
    gradient: "from-red-500/20 to-transparent",
    band: "bg-red-500",
  },
  warning: {
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    dot: "bg-amber-500",
    gradient: "from-amber-500/20 to-transparent",
    band: "bg-amber-500",
  },
  info: {
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    dot: "bg-blue-500",
    gradient: "from-blue-500/20 to-transparent",
    band: "bg-blue-500",
  },
};

const STATUS_CONFIG = {
  open: { color: "text-foreground/70", bg: "bg-foreground/70", label: "Open" },
  acknowledged: {
    color: "text-amber-400",
    bg: "bg-amber-500",
    label: "Acknowledged",
  },
  resolved: {
    color: "text-muted-foreground",
    bg: "bg-muted-foreground/50",
    label: "Resolved",
  },
};

// =============================================================================
// META RAIL — right-side compact fact list (Linear/Vercel-style)
// =============================================================================

// Keys that the meta-rail consumes — also filtered out of the main "Event Data"
// table so the same field doesn't appear twice on screen.
const META_RAIL_KEYS = new Set<string>([
  "sat_id_1",
  "sat_id_2",
  "sat_1_name",
  "sat_1_operator",
  "sat_1_object_type",
  "sat_1_maneuverable",
  "sat_1_tle_epoch_age_hours",
  "sat_2_name",
  "sat_2_operator",
  "sat_2_object_type",
  "sat_2_maneuverable",
  "sat_2_tle_epoch_age_hours",
  "cdm_source",
  "cdm_id",
  "time",
]);

function MetaRailSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </div>
      <dl className="space-y-1">{children}</dl>
    </div>
  );
}

function MetaRailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11px] text-muted-foreground flex-shrink-0">
        {label}
      </dt>
      <dd
        className={cn(
          "text-[11px] tabular-nums text-right truncate min-w-0",
          mono && "font-mono",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function MetaRail({
  alert,
  source,
  severity,
  status,
}: {
  alert: Alert;
  source?: Source | null;
  severity: (typeof SEVERITY_CONFIG)[keyof typeof SEVERITY_CONFIG];
  status: (typeof STATUS_CONFIG)[keyof typeof STATUS_CONFIG];
}) {
  const ctx = (alert.context_snapshot ?? {}) as Record<string, unknown>;
  const sat1Present = ctx.sat_id_1 != null || ctx.sat_1_name != null;
  const sat2Present = ctx.sat_id_2 != null || ctx.sat_2_name != null;
  const cdmPresent = ctx.cdm_source != null || ctx.cdm_id != null;

  const sections: { key: string; node: React.ReactNode }[] = [
    {
      key: "status",
      node: (
        <MetaRailSection label="Status">
          <MetaRailRow
            label="Severity"
            value={
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn("w-1.5 h-1.5 rounded-full", severity.dot)}
                />
                <span className={severity.color}>{alert.severity}</span>
              </span>
            }
          />
          <MetaRailRow label="State" value={status.label.toLowerCase()} />
          <MetaRailRow
            label="Triggered"
            value={format(new Date(alert.triggered_at), "HH:mm:ss 'UTC'")}
            mono
          />
          {source && <MetaRailRow label="Source" value={source.slug} mono />}
        </MetaRailSection>
      ),
    },
  ];

  if (sat1Present) {
    sections.push({
      key: "sat1",
      node: (
        <MetaRailSection label="Object 1 · Chaser">
          {ctx.sat_1_name != null && (
            <MetaRailRow label="Name" value={String(ctx.sat_1_name)} />
          )}
          {ctx.sat_id_1 != null && (
            <MetaRailRow label="NORAD" value={String(ctx.sat_id_1)} mono />
          )}
          {ctx.sat_1_operator != null && (
            <MetaRailRow label="Operator" value={String(ctx.sat_1_operator)} />
          )}
          {ctx.sat_1_object_type != null && (
            <MetaRailRow label="Type" value={String(ctx.sat_1_object_type)} />
          )}
          {ctx.sat_1_maneuverable != null && (
            <MetaRailRow
              label="Maneuverable"
              value={ctx.sat_1_maneuverable ? "yes" : "no"}
            />
          )}
          {ctx.sat_1_tle_epoch_age_hours != null && (
            <MetaRailRow
              label="TLE age"
              value={`${String(ctx.sat_1_tle_epoch_age_hours)}h`}
              mono
            />
          )}
        </MetaRailSection>
      ),
    });
  }

  if (sat2Present) {
    sections.push({
      key: "sat2",
      node: (
        <MetaRailSection label="Object 2 · Target">
          {ctx.sat_2_name != null && (
            <MetaRailRow label="Name" value={String(ctx.sat_2_name)} />
          )}
          {ctx.sat_id_2 != null && (
            <MetaRailRow label="NORAD" value={String(ctx.sat_id_2)} mono />
          )}
          {ctx.sat_2_operator != null && (
            <MetaRailRow label="Operator" value={String(ctx.sat_2_operator)} />
          )}
          {ctx.sat_2_object_type != null && (
            <MetaRailRow label="Type" value={String(ctx.sat_2_object_type)} />
          )}
          {ctx.sat_2_maneuverable != null && (
            <MetaRailRow
              label="Maneuverable"
              value={ctx.sat_2_maneuverable ? "yes" : "no"}
            />
          )}
          {ctx.sat_2_tle_epoch_age_hours != null && (
            <MetaRailRow
              label="TLE age"
              value={`${String(ctx.sat_2_tle_epoch_age_hours)}h`}
              mono
            />
          )}
        </MetaRailSection>
      ),
    });
  }

  if (cdmPresent) {
    sections.push({
      key: "provenance",
      node: (
        <MetaRailSection label="Provenance">
          {ctx.cdm_source != null && (
            <MetaRailRow label="Source" value={String(ctx.cdm_source)} />
          )}
          {ctx.cdm_id != null && (
            <MetaRailRow
              label="CDM ID"
              value={
                <span title={String(ctx.cdm_id)}>{String(ctx.cdm_id)}</span>
              }
              mono
            />
          )}
        </MetaRailSection>
      ),
    });
  }

  return (
    <aside className="sticky top-0 self-start">
      {sections.map(({ key, node }, i) => (
        <div
          key={key}
          className={cn(
            "py-3 first:pt-0",
            i > 0 && "border-t border-border/40",
          )}
        >
          {node}
        </div>
      ))}
    </aside>
  );
}

// =============================================================================
// PROPS
// =============================================================================

interface AlertStoryPanelProps {
  alert: Alert;
  events: AlertEvent[];
  verdictStats?: VerdictStats | null;
  source?: Source | null;
  sourceContext?: SourceContext[];
  onClose: () => void;
  onAction: (action: "acknowledge" | "resolve" | "reopen") => void;
  onAddComment?: (message: string) => Promise<boolean>;
  onResolveWithContext?: (
    notes: string,
    saveToContext: boolean,
  ) => Promise<void>;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function AlertStoryPanel({
  alert,
  events,
  verdictStats,
  source,
  sourceContext = [],
  onClose,
  onAction,
  onAddComment,
  onResolveWithContext,
}: AlertStoryPanelProps) {
  const { canEdit } = useRole();
  const alertStats = useAlertStats(alert, source?.slug ?? null);
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [resolveWhatFixed, setResolveWhatFixed] = useState("");
  const [resolveWhatChanged, setResolveWhatChanged] = useState("");
  const [resolvePrevention, setResolvePrevention] = useState("");
  const [saveToContext, setSaveToContext] = useState(true);
  const [isResolving, setIsResolving] = useState(false);
  const [alertVerdict, setAlertVerdict] = useState<"helpful" | "noise" | null>(
    (alert.current_verdict as "helpful" | "noise" | null) ?? null,
  );

  const submitAlertVerdict = useCallback(
    async (verdict: "helpful" | "noise") => {
      setAlertVerdict(verdict);
      // The verdict is the default-silence training signal: tie it to the alert
      // (current_verdict) and the rule that fired (event metadata), so it rolls
      // up where the silence engine tunes. One PATCH — no more generic feedback.
      try {
        await fetch(`/api/alerts/${alert.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "verdict", verdict }),
        });
      } catch {
        // Best-effort capture — the verdict stays reflected in the UI.
      }
    },
    [alert.id],
  );

  const severity =
    SEVERITY_CONFIG[alert.severity as LimitSeverity] || SEVERITY_CONFIG.info;
  const status =
    STATUS_CONFIG[alert.status as AlertStatus] || STATUS_CONFIG.open;
  const rawActions = alert.recommended_actions;
  const recommendedActions: string[] = Array.isArray(rawActions)
    ? (rawActions as string[])
    : ((rawActions as Record<string, unknown> | null)?.actions as string[]) ||
      [];

  return (
    <>
      {/* Overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="fixed right-0 top-0 bottom-0 w-[720px] bg-background border-l flex flex-col z-50"
      >
        {/* Subtle top accent */}
        <div className={cn("h-px w-full", severity.band, "opacity-40")} />

        {/* Header */}
        <div className="flex-shrink-0 border-b">
          <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                    severity.dot,
                  )}
                />
                <h2 className="font-mono text-sm font-medium truncate">
                  {alert.metric}
                </h2>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={severity.color}>{alert.severity}</span>
                <span aria-hidden>·</span>
                <span>{status.label.toLowerCase()}</span>
                {source && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="font-mono">{source.slug}</span>
                  </>
                )}
                <span aria-hidden>·</span>
                <span>
                  {formatDistanceToNow(new Date(alert.triggered_at), {
                    addSuffix: true,
                  })}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-7 w-7 flex-shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 px-3 pb-2">
            {canEdit && alert.status === "open" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAction("acknowledge")}
                className="h-7 text-xs gap-1.5"
              >
                <Eye className="h-3 w-3" />
                Acknowledge
                <KeyboardHint keys="A" />
              </Button>
            )}
            {canEdit &&
              (alert.status === "open" || alert.status === "acknowledged") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowResolveDialog(true)}
                  className="h-7 text-xs gap-1.5"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Resolve
                  <KeyboardHint keys="R" />
                </Button>
              )}
            {canEdit && alert.status === "resolved" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAction("reopen")}
                className="h-7 text-xs gap-1.5"
              >
                <RotateCcw className="h-3 w-3" />
                Reopen
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-[1fr_180px] gap-5 p-4">
            <div className="min-w-0 space-y-4">
              <AlertStatsCard stats={alertStats} />
              {(() => {
                const ctx = alert.context_snapshot as Record<
                  string,
                  unknown
                > | null;
                const systemKeys = ["attachments", "_visualization"];
                const dataEntries =
                  ctx && typeof ctx === "object" && !Array.isArray(ctx)
                    ? Object.entries(ctx).filter(
                        ([k]) =>
                          !systemKeys.includes(k) &&
                          !META_RAIL_KEYS.has(k) &&
                          typeof ctx[k] !== "object",
                      )
                    : [];
                const visualization = ctx?._visualization as
                  | {
                      panel_type: string;
                      panel_config: Record<string, unknown>;
                    }
                  | undefined;

                return dataEntries.length > 0 ? (
                  <>
                    <div>
                      <h3 className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-2">
                        Event Data
                      </h3>
                      <div className="divide-y divide-border/40 border-y border-border/40">
                        {dataEntries.map(([key, val]) => (
                          <div
                            key={key}
                            className="flex items-center justify-between py-1.5"
                          >
                            <span className="text-[11px] text-muted-foreground">
                              {key
                                .replace(/_/g, " ")
                                .replace(/\b\w/g, (c) => c.toUpperCase())}
                            </span>
                            <span className="text-[11px] font-mono tabular-nums">
                              {String(val)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {visualization && (
                      <AlertVisualization
                        alertId={alert.id}
                        visualization={visualization}
                        triggeredAt={alert.triggered_at}
                        contextData={
                          alert.context_snapshot as Record<string, unknown>
                        }
                      />
                    )}
                  </>
                ) : (
                  (() => {
                    const v = Number(alert.value);
                    const t =
                      alert.threshold != null ? Number(alert.threshold) : null;
                    const hasDelta =
                      Number.isFinite(v) && t != null && Number.isFinite(t);
                    const deltaPct = hasDelta
                      ? ((v - t) / Math.max(Math.abs(t), 1e-9)) * 100
                      : null;
                    const overMax = alert.bound === "max" && hasDelta && v > t;
                    const underMin = alert.bound === "min" && hasDelta && v < t;
                    const arrow = overMax ? "↑" : underMin ? "↓" : "";
                    const relation = overMax
                      ? "over"
                      : underMin
                        ? "under"
                        : "of";
                    const thresholdLabel =
                      alert.bound === "max"
                        ? "Max threshold"
                        : alert.bound === "min"
                          ? "Min threshold"
                          : "Threshold";
                    const barPct = hasDelta
                      ? Math.min(
                          (Math.abs(v - t) / Math.max(Math.abs(t), 1)) * 100,
                          100,
                        )
                      : 0;
                    return (
                      <div className="border-y border-border/40 py-4 space-y-3">
                        <div className="flex items-baseline justify-between gap-6">
                          <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                              Value
                            </div>
                            <div className="text-3xl font-mono font-medium tabular-nums leading-none truncate">
                              {typeof alert.value === "number"
                                ? alert.value.toFixed(2)
                                : String(alert.value)}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                              {thresholdLabel}
                            </div>
                            <div className="text-lg font-mono tabular-nums text-muted-foreground leading-none">
                              {alert.threshold ?? "—"}
                            </div>
                          </div>
                        </div>
                        {hasDelta && deltaPct != null && (
                          <>
                            <div className="flex items-center gap-2 text-[11px] tabular-nums">
                              {arrow && (
                                <span
                                  className={cn("font-medium", severity.color)}
                                >
                                  {arrow} {Math.abs(deltaPct).toFixed(1)}%
                                </span>
                              )}
                              <span className="text-muted-foreground">
                                {relation} {alert.threshold}
                              </span>
                            </div>
                            <div className="relative h-px bg-border/40 overflow-hidden">
                              <div
                                className={cn(
                                  "absolute inset-y-0 left-0",
                                  severity.band,
                                )}
                                style={{ width: `${barPct}%` }}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()
                );
              })()}

              {/* Causality Timeline */}
              <CausalityTimeline
                events={events}
                alert={alert}
                onAddComment={canEdit ? onAddComment : undefined}
              />

              {/* Action Cards */}
              {recommendedActions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Wrench className="h-3.5 w-3.5" />
                    Recommended Actions
                  </div>
                  <div className="space-y-1.5">
                    {recommendedActions.map((action, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="flex items-start gap-2.5 p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10 hover:bg-emerald-500/10 transition-colors cursor-default"
                      >
                        <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-medium text-emerald-400">
                            {i + 1}
                          </span>
                        </div>
                        <div className="text-sm text-foreground/90 flex-1">
                          <ReactMarkdown
                            components={{
                              strong: ({ children }) => (
                                <strong className="font-semibold text-foreground">
                                  {children}
                                </strong>
                              ),
                              code: ({ children }) => (
                                <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono text-emerald-300">
                                  {children}
                                </code>
                              ),
                              p: ({ children }) => <span>{children}</span>,
                            }}
                          >
                            {action}
                          </ReactMarkdown>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Alert verdict — on-call judgment captured as training signal */}
              {canEdit && (
                <div className="space-y-2">
                  {verdictStats && verdictStats.noise > 0 && (
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs text-amber-300/90">
                      <ThumbsDown className="h-3 w-3 flex-shrink-0" />
                      <span>
                        Heads up — alerts like this were marked{" "}
                        <span className="font-medium">noise</span>{" "}
                        {verdictStats.noise} of the last {verdictStats.total}{" "}
                        {verdictStats.total === 1 ? "time" : "times"}
                        {source ? ` on ${source.name || source.slug}` : ""}.
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg border bg-muted/30">
                    {alertVerdict === null ? (
                      <>
                        <div className="text-xs text-muted-foreground">
                          Was this alert worth firing?
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-xs gap-1.5"
                            onClick={() => submitAlertVerdict("helpful")}
                          >
                            <ThumbsUp className="h-3 w-3" />
                            Helpful
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-xs gap-1.5"
                            onClick={() => submitAlertVerdict("noise")}
                          >
                            <ThumbsDown className="h-3 w-3" />
                            Noise
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        Recorded — your team&apos;s judgment tunes this
                        fleet&apos;s alerting.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Source Context */}
              {source && (
                <div className="p-3 rounded-lg bg-muted/20 border border-border/50 space-y-2">
                  <div className="flex items-center gap-2">
                    {source.source_type === "connection" ? (
                      <Database className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : source.device_type === "satellite" ? (
                      <Satellite className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <Radio className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">
                      {source.name || source.slug}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {source.device_type || source.source_type}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link
                      href={
                        source.source_type === "device"
                          ? `/devices/${source.slug}`
                          : `/connections/${source.slug}`
                      }
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      View Source
                      <ArrowRight className="h-2.5 w-2.5" />
                    </Link>
                  </div>
                </div>
              )}

              {/* Reference Docs */}
              {sourceContext.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <BookOpen className="h-3.5 w-3.5" />
                    Reference Docs
                  </div>
                  {sourceContext.map((ctx) => (
                    <a
                      key={ctx.id}
                      href={ctx.link_url || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-muted/20",
                        "hover:bg-muted/40 hover:border-border transition-all group",
                        !ctx.link_url && "pointer-events-none",
                      )}
                    >
                      <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm truncate flex-1">
                        {ctx.name}
                      </span>
                      {ctx.link_url && (
                        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
            <MetaRail
              alert={alert}
              source={source}
              severity={severity}
              status={status}
            />
          </div>
        </div>

        <ResolveDialog
          alert={alert}
          open={showResolveDialog}
          onOpenChange={setShowResolveDialog}
          onAction={onAction}
          onResolveWithContext={onResolveWithContext}
          resolveWhatFixed={resolveWhatFixed}
          setResolveWhatFixed={setResolveWhatFixed}
          resolveWhatChanged={resolveWhatChanged}
          setResolveWhatChanged={setResolveWhatChanged}
          resolvePrevention={resolvePrevention}
          setResolvePrevention={setResolvePrevention}
          saveToContext={saveToContext}
          setSaveToContext={setSaveToContext}
          isResolving={isResolving}
          setIsResolving={setIsResolving}
        />
      </motion.div>
    </>
  );
}

// =============================================================================
// CAUSALITY TIMELINE
// =============================================================================

const EVENT_TYPE_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  created: Zap,
  acknowledged: Eye,
  resolved: CheckCircle2,
  reopened: RotateCcw,
  comment: MessageSquare,
  verdict: ThumbsUp,
};

function CausalityTimeline({
  events,
  onAddComment,
}: {
  events: AlertEvent[];
  alert: Alert;
  onAddComment?: (message: string) => Promise<boolean>;
}) {
  const [commentText, setCommentText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getEventLabel = (type: string) => {
    switch (type) {
      case "created":
        return "Alert triggered";
      case "acknowledged":
        return "Acknowledged";
      case "resolved":
        return "Marked as resolved";
      case "reopened":
        return "Reopened";
      case "comment":
        return "Comment added";
      case "verdict":
        return "Verdict recorded";
      default:
        return type.replace(/_/g, " ");
    }
  };

  const handleSubmitComment = async () => {
    if (!commentText.trim() || !onAddComment) return;
    setIsSubmitting(true);
    try {
      const success = await onAddComment(commentText.trim());
      if (success) setCommentText("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const sortedEvents = [...events].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Activity className="h-3.5 w-3.5" />
        Timeline
      </div>

      {sortedEvents.length === 0 ? (
        <div className="text-center py-4 text-xs text-muted-foreground">
          No activity yet
        </div>
      ) : (
        <div className="relative pl-5">
          {sortedEvents.length > 1 && (
            <div
              className="absolute left-[7px] w-px bg-border"
              style={{ top: "8px", bottom: "8px" }}
            />
          )}
          <div className="space-y-3">
            {sortedEvents.map((event, index) => {
              const isLast = index === sortedEvents.length - 1;
              const eventDate = new Date(event.created_at);
              const EventIcon = EVENT_TYPE_ICONS[event.event_type] || Activity;

              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="relative flex items-start gap-3 -ml-5"
                >
                  <div
                    className={cn(
                      "relative z-10 w-[15px] h-[15px] rounded-full flex items-center justify-center flex-shrink-0 mt-[1px]",
                      isLast ? "bg-foreground/10" : "bg-muted",
                    )}
                  >
                    <EventIcon
                      className={cn(
                        "h-2.5 w-2.5",
                        isLast ? "text-foreground" : "text-muted-foreground",
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "text-xs leading-none",
                          isLast
                            ? "text-foreground font-medium"
                            : "text-muted-foreground",
                        )}
                      >
                        {getEventLabel(event.event_type)}
                      </span>
                      <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
                        {format(eventDate, "h:mm a")}
                      </span>
                    </div>
                    {event.message && (
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                        {event.message}
                      </p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Duration */}
      {sortedEvents.length >= 2 && (
        <div className="pt-2 border-t border-border/50">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Time since triggered</span>
            <span className="tabular-nums">
              {formatDistanceToNow(new Date(sortedEvents[0].created_at), {
                addSuffix: false,
              })}
            </span>
          </div>
        </div>
      )}

      {/* Comment input */}
      {onAddComment && (
        <div className="pt-2 border-t border-border/50">
          <div className="flex gap-2">
            <Input
              placeholder="Add a comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmitComment();
                }
              }}
              className="h-8 text-xs"
              disabled={isSubmitting}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleSubmitComment}
              disabled={!commentText.trim() || isSubmitting}
              className="h-8 px-3"
            >
              {isSubmitting ? (
                <Spinner variant="button" className="h-3 w-3" />
              ) : (
                <MessageSquare className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// RESOLVE DIALOG
// =============================================================================

function ResolveDialog({
  alert,
  open,
  onOpenChange,
  onAction,
  onResolveWithContext,
  resolveWhatFixed,
  setResolveWhatFixed,
  resolveWhatChanged,
  setResolveWhatChanged,
  resolvePrevention,
  setResolvePrevention,
  saveToContext,
  setSaveToContext,
  isResolving,
  setIsResolving,
}: {
  alert: Alert;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (action: "acknowledge" | "resolve" | "reopen") => void;
  onResolveWithContext?: (
    notes: string,
    saveToContext: boolean,
  ) => Promise<void>;
  resolveWhatFixed: string;
  setResolveWhatFixed: (v: string) => void;
  resolveWhatChanged: string;
  setResolveWhatChanged: (v: string) => void;
  resolvePrevention: string;
  setResolvePrevention: (v: string) => void;
  saveToContext: boolean;
  setSaveToContext: (v: boolean) => void;
  isResolving: boolean;
  setIsResolving: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Resolve Alert</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs font-medium block mb-1.5">
              What fixed it?
            </Label>
            <Textarea
              placeholder="Describe the root cause and what was done to resolve it..."
              value={resolveWhatFixed}
              onChange={(e) => setResolveWhatFixed(e.target.value)}
              className="min-h-[60px] resize-none"
            />
          </div>
          <div>
            <Label className="text-xs font-medium block mb-1.5">
              What changed?
            </Label>
            <Textarea
              placeholder="Config updates, code deploys, hardware swaps..."
              value={resolveWhatChanged}
              onChange={(e) => setResolveWhatChanged(e.target.value)}
              className="min-h-[40px] resize-none"
            />
          </div>
          <div>
            <Label className="text-xs font-medium block mb-1.5">
              How to prevent recurrence?
            </Label>
            <Textarea
              placeholder="Follow-up actions, monitoring changes, updates..."
              value={resolvePrevention}
              onChange={(e) => setResolvePrevention(e.target.value)}
              className="min-h-[40px] resize-none"
            />
          </div>
          {alert.source_id && (
            <Label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-muted/30 border border-border/50">
              <Checkbox
                checked={saveToContext}
                onCheckedChange={(checked) =>
                  setSaveToContext(checked === true)
                }
                className="h-4 w-4 rounded border-border"
              />
              <div>
                <span className="text-xs font-medium block">
                  Save as source context
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Future AI analyses will reference this resolution
                </span>
              </div>
            </Label>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange(false);
              setResolveWhatFixed("");
              setResolveWhatChanged("");
              setResolvePrevention("");
              setSaveToContext(true);
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            loading={isResolving}
            onClick={async () => {
              setIsResolving(true);
              try {
                const parts: string[] = [];
                if (resolveWhatFixed.trim())
                  parts.push(`**What fixed it:** ${resolveWhatFixed.trim()}`);
                if (resolveWhatChanged.trim())
                  parts.push(`**What changed:** ${resolveWhatChanged.trim()}`);
                if (resolvePrevention.trim())
                  parts.push(`**Prevention:** ${resolvePrevention.trim()}`);
                const notes = parts.join("\n\n");

                if (onResolveWithContext) {
                  await onResolveWithContext(notes, saveToContext);
                } else {
                  onAction("resolve");
                }
                onOpenChange(false);
                setResolveWhatFixed("");
                setResolveWhatChanged("");
                setResolvePrevention("");
                setSaveToContext(true);
              } finally {
                setIsResolving(false);
              }
            }}
          >
            Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
