"use client";

import { useEffect, useMemo, useRef } from "react";
import { AttitudeIndicator } from "@/components/ui/charts/attitude-indicator";
import { usePanelData } from "@/hooks/use-panel-data";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { Spinner } from "@/components/ui/spinner";
import { PanelEmptyState } from "@/components/dashboard/panels/panel-empty-state";

interface AttitudePanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

/**
 * Attitude Indicator panel for aircraft/spacecraft orientation
 * Supports realtime, table, and connection data sources
 * Expects metrics for pitch, roll, and optionally heading/yaw
 */
export function AttitudePanel({ panel, timeRange }: AttitudePanelProps) {
  const {
    data,
    isLoading,
    error,
    sourceType,
    metrics,
    refresh,
  } = usePanelData({
    panel,
    timeRange,
  });

  // Extract pitch, roll, and heading from metrics
  const { pitch, roll, heading } = useMemo(() => {
    if (!data) return { pitch: 0, roll: 0, heading: null as number | null };

    let pitchValue = 0;
    let rollValue = 0;
    let headingValue: number | null = null;

    const keysToUse = metrics.length > 0 ? metrics : Object.keys(data);

    for (const metric of keysToUse) {
      const metricData = data[metric] || [];
      const latest = metricData[metricData.length - 1];

      if (!latest || typeof latest.value !== "number") continue;

      const lowerName = metric.toLowerCase();
      if (lowerName.includes("pitch")) {
        pitchValue = latest.value;
      } else if (lowerName.includes("roll")) {
        rollValue = latest.value;
      } else if (lowerName.includes("heading") || lowerName.includes("yaw")) {
        headingValue = latest.value;
      }
    }

    // If no named metrics, use positional order
    if (pitchValue === 0 && rollValue === 0) {
      if (keysToUse.length >= 2) {
        const pitchData = data[keysToUse[0]] || [];
        const rollData = data[keysToUse[1]] || [];
        const latestPitch = pitchData[pitchData.length - 1];
        const latestRoll = rollData[rollData.length - 1];

        if (latestPitch && typeof latestPitch.value === "number") {
          pitchValue = latestPitch.value;
        }
        if (latestRoll && typeof latestRoll.value === "number") {
          rollValue = latestRoll.value;
        }

        // Third metric as heading
        if (keysToUse.length >= 3 && headingValue === null) {
          const hdgData = data[keysToUse[2]] || [];
          const latestHdg = hdgData[hdgData.length - 1];
          if (latestHdg && typeof latestHdg.value === "number") {
            headingValue = latestHdg.value;
          }
        }
      } else if (keysToUse.length === 1) {
        const metricData = data[keysToUse[0]] || [];
        const latest = metricData[metricData.length - 1];
        if (latest && typeof latest.value === "number") {
          pitchValue = latest.value;
        }
      }
    }

    return { pitch: pitchValue, roll: rollValue, heading: headingValue };
  }, [data, metrics]);

  const bgImage = panel.config.backgroundImage;
  const bgVideoUrl = (panel.config as { backgroundVideoUrl?: string }).backgroundVideoUrl;
  const bgOpacity = panel.config.backgroundImageOpacity ?? 0.85;
  const hasBackdrop = !!(bgImage || bgVideoUrl);

  // ── Smooth backdrop motion ─────────────────────────────────────────
  // Telemetry arrives at 1 Hz — a CSS transition alone eases into each
  // value and then holds dead-still until the next point. That "dart
  // then stop" feels jumpy. Instead: RAF loop lerps a "display" state
  // toward the latest target and writes transform *directly* to the
  // DOM node (no React re-render per frame). Alpha 0.12 gives a
  // critically-damped feel — by the next 1 s data point, the photo has
  // settled ~99% of the way there.
  //
  // IMPORTANT: hooks MUST be called above the conditional early returns
  // below to keep the hook count stable across renders (React #310).
  const photoRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef({ pitch, roll });
  const displayRef = useRef({ pitch, roll });

  // Keep the RAF target in sync with the latest telemetry (latest-value ref).
  useEffect(() => {
    targetRef.current = { pitch, roll };
  });

  useEffect(() => {
    if (!hasBackdrop) return;
    let raf = 0;
    const tick = () => {
      const t = targetRef.current;
      const d = displayRef.current;
      const alpha = 0.12;
      d.pitch += (t.pitch - d.pitch) * alpha;
      d.roll += (t.roll - d.roll) * alpha;
      const el = photoRef.current;
      if (el) {
        const tY = Math.max(-40, Math.min(40, d.pitch * 0.9));
        el.style.transform = `rotate(${-d.roll}deg) translateY(${tY}%) scale(1.35)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hasBackdrop]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

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

  return (
    <div className="h-full w-full flex flex-col relative overflow-hidden">
      {/* Optional backdrop — static image (photo) or video URL (e.g.
          forward-camera loop). Rotates + translates with pitch/roll so
          orientation reads against the real environment. When a backdrop
          is set, the attitude indicator's sky/ground dims so the photo
          or video bleeds through as the real backdrop. */}
      {bgVideoUrl && (
        <div
          ref={photoRef}
          className="absolute inset-0 pointer-events-none will-change-transform"
          style={{
            opacity: bgOpacity,
            transformOrigin: "center",
            overflow: "hidden",
          }}
        >
          <video
            src={bgVideoUrl}
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />
        </div>
      )}
      {bgImage && !bgVideoUrl && (
        <div
          ref={photoRef}
          className="absolute inset-0 pointer-events-none will-change-transform"
          style={{
            backgroundImage: `url(${bgImage})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: bgOpacity,
            transformOrigin: "center",
          }}
        />
      )}
      <div
        className="relative flex-1 min-h-0 flex items-center justify-center"
        style={hasBackdrop ? { opacity: 0.55, mixBlendMode: "screen" as const } : undefined}
      >
        <AttitudeIndicator
          pitch={pitch}
          roll={roll}
          width="100%"
          height="100%"
        />
      </div>

      {/* Numeric readouts */}
      <div className="relative px-3 py-1.5 border-t border-border flex items-center justify-center gap-4 text-xs font-mono text-muted-foreground bg-background/60 backdrop-blur-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
            Pitch
          </span>
          <span className="tabular-nums font-medium text-foreground">
            {pitch.toFixed(1)}°
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
            Roll
          </span>
          <span className="tabular-nums font-medium text-foreground">
            {roll.toFixed(1)}°
          </span>
        </div>
        {heading !== null && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
              Hdg
            </span>
            <span className="tabular-nums font-medium text-foreground">
              {heading.toFixed(0)}°
            </span>
            {/* Mini compass indicator */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              className="text-primary"
            >
              <circle
                cx="7"
                cy="7"
                r="6"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.5"
                opacity="0.3"
              />
              <line
                x1="7"
                y1="7"
                x2={7 + 5 * Math.sin((heading * Math.PI) / 180)}
                y2={7 - 5 * Math.cos((heading * Math.PI) / 180)}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
