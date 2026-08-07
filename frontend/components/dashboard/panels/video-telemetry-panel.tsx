"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useVideo } from "@/components/dashboard/video-context";
import { useRealtimeVideo } from "@/hooks/realtime/use-realtime-data";
import { usePanelData } from "@/hooks/use-panel-data";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import type { VideoTelemetryPanelConfig } from "@/lib/types/panel-configs";
import { Spinner } from "@/components/ui/spinner";
import { Video, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnnotationMode } from "@/hooks/use-annotation-mode";
import {
  AnnotationToolbar,
  AnnotationModeIndicator,
} from "@/components/annotations/annotation-toolbar";
import { AnnotationPopover } from "@/components/annotations/annotation-popover";
import { AnnotationsPanel } from "@/components/annotations/annotations-panel";

interface VideoTelemetryPanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

// ─── Metric name parsing ─────────────────────────────────────────────────────

const UNIT_SUFFIXES: Record<string, string> = {
  _c: "°C",
  _f: "°F",
  _m: "m",
  _km: "km",
  _kmh: "km/h",
  _mph: "mph",
  _pct: "%",
  _deg: "°",
  _dps: "°/s",
  _v: "V",
  _a: "A",
  _hpa: "hPa",
  _pa: "Pa",
  _g: "g",
  _ms: "m/s",
};

function parseMetricName(metric: string): { label: string; unit: string } {
  // Strip source prefix (everything before first colon)
  let name = metric.includes(":") ? metric.split(":").slice(1).join(":") : metric;

  // Check for known unit suffixes (longest match first)
  let unit = "";
  const suffixes = Object.keys(UNIT_SUFFIXES).sort((a, b) => b.length - a.length);
  for (const suffix of suffixes) {
    if (name.endsWith(suffix)) {
      unit = UNIT_SUFFIXES[suffix];
      name = name.slice(0, -suffix.length);
      break;
    }
  }

  // Special cases
  if (name === "engine_rpm" || name === "rpm") {
    return { label: "RPM", unit: "" };
  }

  // Convert snake_case to Title Case
  const label = name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

  return { label, unit };
}

// ─── Camera metric parsing (same as video-panel.tsx) ─────────────────────────

function parseCameraFromMetrics(metrics: string[]): { sourceId: string; cameraId: string } | null {
  const cameraMetric = metrics.find((m) => m.includes(":$camera:"));
  if (!cameraMetric) return null;

  const markerStart = cameraMetric.indexOf(":$camera:");
  if (markerStart === -1) return null;

  const sourceId = cameraMetric.substring(0, markerStart);
  const cameraId = cameraMetric.substring(markerStart + ":$camera:".length);
  return { sourceId, cameraId };
}

// ─── HUD Badge ───────────────────────────────────────────────────────────────

function HudBadge({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  const formatted = value !== null
    ? Math.abs(value) >= 100
      ? value.toFixed(0)
      : Math.abs(value) >= 10
        ? value.toFixed(1)
        : value.toFixed(2)
    : "—";

  return (
    <div className="bg-black/60 backdrop-blur-sm border border-white/10 rounded px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-white/50 leading-none">
        {label}
      </div>
      <div className="text-lg font-mono font-medium text-white tabular-nums leading-tight mt-0.5">
        {formatted}
        {unit && <span className="text-xs text-white/50 ml-1">{unit}</span>}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function VideoTelemetryPanel({ panel, timeRange }: VideoTelemetryPanelProps) {
  const config = panel.config as VideoTelemetryPanelConfig;
  const allMetrics = useMemo(() => panel.metrics || [], [panel.metrics]);

  const panelSourceId = panel.config.sourceId || panel.sources?.[0] || null;
  const ann = useAnnotationMode({ sourceId: panelSourceId, enabled: !!panelSourceId });

  // Separate camera metrics from telemetry metrics
  const cameraFromMetrics = useMemo(
    () => parseCameraFromMetrics(allMetrics),
    [allMetrics],
  );
  const telemetryMetrics = useMemo(
    () => allMetrics.filter((m) => !m.includes(":$camera:")),
    [allMetrics],
  );

  // Camera config
  const sourceId = cameraFromMetrics?.sourceId || config.sourceId;
  const configuredCameraId = cameraFromMetrics?.cameraId || config.cameraId;
  const cameraId = configuredCameraId || "default";
  const frameRate = config.frameRate || 10;

  const { videoFrameStore, startCamera, isConnected, isSharedView } = useVideo();
  // Subscribe at panel level so only this panel re-renders on incoming frames
  const videoFrames = useRealtimeVideo(videoFrameStore);

  const [hasReceivedFrame, setHasReceivedFrame] = useState(false);
  const cameraHandleRef = useRef<{ stop: () => void } | null>(null);

  // We're streaming exactly while the camera-start effect below is active —
  // i.e. when these conditions hold. Derived instead of mirrored into state.
  const isStreaming =
    !isSharedView && isConnected && !!sourceId && !!startCamera;

  // Start camera stream
  useEffect(() => {
    if (isSharedView) return;
    if (!isConnected || !sourceId || !startCamera) return;

    const handle = startCamera(sourceId, cameraId, frameRate);
    cameraHandleRef.current = handle;

    return () => {
      handle.stop();
      cameraHandleRef.current = null;
    };
  }, [isConnected, sourceId, cameraId, frameRate, startCamera, isSharedView]);

  // When no cameraId is explicitly configured, accept any frame from this
  // source so devices that report a camera_id other than "default" (e.g.
  // "picam:0", "cam-1") still render.
  const frameKey = sourceId ? `${sourceId}:${cameraId}` : "";
  let currentFrame = frameKey ? videoFrames[frameKey] : undefined;
  if (!currentFrame && !configuredCameraId && sourceId) {
    const prefix = `${sourceId}:`;
    const fallbackKey = Object.keys(videoFrames).find((k) => k.startsWith(prefix));
    if (fallbackKey) currentFrame = videoFrames[fallbackKey];
  }

  // Latch: once we've rendered a frame, stay "received" even if frames pause.
  // Guarded adjust-state-during-render (runs once, then the guard is false).
  if (currentFrame && !hasReceivedFrame) {
    setHasReceivedFrame(true);
  }

  // Telemetry data — build a synthetic panel with only telemetry metrics
  const telemetryPanel = useMemo(
    () => ({ ...panel, metrics: telemetryMetrics }),
    [panel, telemetryMetrics],
  );

  const { data } = usePanelData({
    panel: telemetryPanel,
    timeRange,
  });

  // Build overlay values
  const overlayValues = useMemo(() => {
    return telemetryMetrics.map((metric) => {
      const points = data[metric] || [];
      const latest = points[points.length - 1];
      const { label, unit } = parseMetricName(metric);
      return {
        metric,
        label,
        unit,
        value: latest && typeof latest.value === "number" ? latest.value : null,
      };
    });
  }, [data, telemetryMetrics]);

  // Latest telemetry timestamp for annotation placement
  const latestTimestamp = useMemo(() => {
    for (const metric of telemetryMetrics) {
      const points = data[metric] || [];
      if (points.length > 0) return points[points.length - 1].timestamp;
    }
    return new Date().toISOString();
  }, [data, telemetryMetrics]);

  // Click handler: annotate at current frame/telemetry timestamp
  const handleAnnotateClick = useCallback(
    (e: React.MouseEvent) => {
      if (ann.mode === "off") return;
      ann.openPopover(e.clientX, e.clientY, latestTimestamp);
    },
    [ann, latestTimestamp],
  );

  // Shared annotation UI rendered after the panel content
  const annotationUI = (
    <>
      {ann.popover && (
        <AnnotationPopover
          x={ann.popover.x}
          y={ann.popover.y}
          initialLabel={ann.popover.initialLabel}
          initialColor={ann.popover.initialColor}
          initialNotes={ann.popover.initialNotes}
          timestamp={ann.popover.timestamp}
          showDelete={!!ann.popover.editingId}
          onSave={ann.handleSave}
          onDelete={ann.handleDelete}
          onDismiss={ann.closePopover}
        />
      )}
      <AnnotationsPanel
        open={ann.showPanel}
        onOpenChange={ann.setShowPanel}
        annotations={ann.annotations}
        onEdit={ann.handlePanelEdit}
        onDelete={(id) => ann.deleteAnnotation(id)}
      />
    </>
  );

  // ─── No camera configured — show telemetry-only mode ────────────────────

  if (!sourceId) {
    if (telemetryMetrics.length === 0) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
          <VideoOff className="h-8 w-8" />
          <span className="text-sm">Add a camera or metrics to get started</span>
        </div>
      );
    }

    // Telemetry only — dark background with HUD badges centered
    return (
      <div className="h-full w-full relative bg-black overflow-hidden flex items-center justify-center">
        <div className="flex flex-wrap gap-3 p-4 justify-center">
          {overlayValues.map((ov) => (
            <HudBadge key={ov.metric} label={ov.label} value={ov.value} unit={ov.unit} />
          ))}
        </div>
      </div>
    );
  }

  // ─── Connecting ─────────────────────────────────────────────────────────

  if (!isConnected && !isSharedView) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
        <Spinner />
        <span className="text-sm">Connecting...</span>
      </div>
    );
  }

  // ─── Waiting for first frame ────────────────────────────────────────────

  if (!currentFrame) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
        <Video className="h-8 w-8 animate-pulse" />
        <span className="text-sm">
          {isSharedView ? "Waiting for video stream..." : "Waiting for video..."}
        </span>
        {/* Show telemetry badges even while waiting for video */}
        {overlayValues.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4 justify-center">
            {overlayValues.map((ov) => (
              <HudBadge key={ov.metric} label={ov.label} value={ov.value} unit={ov.unit} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Video + HUD overlay ────────────────────────────────────────────────

  return (
    <>
      <div className="h-full w-full flex flex-col bg-black overflow-hidden">
        <div
          className={cn(
            "flex-1 min-h-0 relative",
            ann.mode === "on" ? "cursor-cell" : "",
          )}
          onClick={handleAnnotateClick}
        >
          {/* Video frame */}
          {/* eslint-disable-next-line @next/next/no-img-element -- live base64 video frame, not a static asset */}
          <img
            src={`data:image/jpeg;base64,${currentFrame.frame}`}
            alt="Camera feed"
            className="h-full w-full object-contain"
          />

          {/* HUD overlay */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Top: telemetry badges */}
            {overlayValues.length > 0 && (
              <div className="absolute top-3 left-3 right-3 flex flex-wrap gap-2">
                {overlayValues.map((ov) => (
                  <HudBadge key={ov.metric} label={ov.label} value={ov.value} unit={ov.unit} />
                ))}
              </div>
            )}

            {/* Bottom: frame info + status */}
            <div className="absolute bottom-2 left-2 flex items-center gap-2 text-xs text-white/70 bg-black/50 px-2 py-1 rounded">
              <div
                className={cn(
                  "h-2 w-2 rounded-full",
                  (isSharedView || isStreaming) ? "bg-green-500 animate-pulse" : "bg-red-500",
                )}
              />
              <span>
                {currentFrame.width}x{currentFrame.height}
              </span>
            </div>
          </div>

          <AnnotationModeIndicator
            mode={ann.mode}
            onClose={() => ann.setMode("off")}
          />
        </div>
        {/* Annotation toolbar */}
        <div className="px-2 py-1 border-t border-white/10 bg-black/80 shrink-0">
          <AnnotationToolbar
            mode={ann.mode}
            setMode={ann.setMode}
            annotationCount={ann.annotations.length}
            onShowPanel={() => ann.setShowPanel(true)}
          />
        </div>
      </div>
      {annotationUI}
    </>
  );
}
