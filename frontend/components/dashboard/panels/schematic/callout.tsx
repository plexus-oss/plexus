"use client";

/**
 * Telemetry callout — Linear-inspired value chip.
 *
 *   ┌──────────────────────────┐
 *   │ rack a temp              │  ← label (lowercase, muted, mono)
 *   │ 32.4 °C       ↑ 0.4      │  ← value (mono, bold) + delta
 *   ├──────────────────────────┤  ← hairline divider (only if extras)
 *   │ warn 32  crit 40 · live  │  ← thresholds + recency (extras row)
 *   └──────────────────────────┘
 *
 * The extras row only renders when there's something to show — keeps
 * idle pins compact. Border and divider are 1px white at very low
 * opacity (Linear's signature restraint).
 */

import { useMemo } from "react";
import type { TelemetryBinding } from "@/lib/types/dashboard";
import {
  SCHEMATIC_THEME,
  thresholdFor,
  type ThresholdState,
} from "@/lib/schematic/theme";

export interface CalloutExtras {
  /** Difference between latest value and a value ~`deltaWindowSec` ago. */
  delta?: number;
  /** Window size used to compute delta (for the "↑ 0.4 / 60s" label). */
  deltaWindowSec?: number;
  /** ISO timestamp of the latest data point — used for the recency dot. */
  lastUpdatedAt?: string;
}

interface CalloutProps {
  binding: TelemetryBinding;
  value: number | string | null;
  defaultUnit?: string;
  className?: string;
  selected?: boolean;
  extras?: CalloutExtras;
  /** Compact mode for dense surfaces (3D overlay): no extras row,
   * tighter padding, smaller value text. */
  compact?: boolean;
}

export function Callout({
  binding,
  value,
  defaultUnit,
  className,
  selected,
  extras,
  compact = false,
}: CalloutProps) {
  const state: ThresholdState = useMemo(() => {
    if (typeof value !== "number") return "normal";
    return thresholdFor(
      value,
      binding.thresholdWarning,
      binding.thresholdCritical,
    );
  }, [value, binding.thresholdWarning, binding.thresholdCritical]);

  const colors = SCHEMATIC_THEME.threshold[state];
  const label = binding.label ?? labelFromMetric(binding.metric);
  const unit = binding.unit ?? defaultUnit ?? "";

  const shadow =
    state === "critical"
      ? `0 0 0 1px ${colors.border}, 0 0 12px -2px ${colors.stroke}`
      : `0 0 0 1px ${colors.border}`;

  // Build the "extras" content based on what we have. We only show the
  // row when there's at least one meaningful piece of info.
  const recency = useMemo(
    () => formatRecency(extras?.lastUpdatedAt),
    [extras?.lastUpdatedAt],
  );
  const hasThresholdInfo =
    binding.thresholdWarning !== undefined ||
    binding.thresholdCritical !== undefined;
  const hasExtras =
    extras?.delta !== undefined || hasThresholdInfo || !!recency;

  return (
    <div
      className={
        "select-none transition-colors duration-150 overflow-hidden " +
        (className ?? "")
      }
      style={{
        background: colors.bg,
        color: colors.fg,
        boxShadow: shadow,
        borderRadius: SCHEMATIC_THEME.callout.radius,
        outline: selected
          ? `${SCHEMATIC_THEME.edit.ringWidth}px solid ${SCHEMATIC_THEME.edit.ringColor}`
          : undefined,
        outlineOffset: selected ? "2px" : undefined,
      }}
    >
      {binding.display === "indicator" ? (
        <IndicatorBody label={label} state={state} />
      ) : binding.display === "state" ? (
        <StateBody binding={binding} value={value} label={label} compact={compact} />
      ) : (
        <ValueBody
          value={value}
          unit={unit}
          label={label}
          binding={binding}
          delta={extras?.delta}
          compact={compact}
        />
      )}

      {/* Extras row only in non-compact mode. Compact mode (3D overlay)
          stays tight: two lines per chip max. */}
      {!compact && binding.display === "value" && hasExtras && (
        <ExtrasRow
          delta={extras?.delta}
          deltaWindowSec={extras?.deltaWindowSec}
          unit={unit}
          warn={binding.thresholdWarning}
          critical={binding.thresholdCritical}
          recency={recency}
          state={state}
        />
      )}
    </div>
  );
}

// ─── Bodies ──────────────────────────────────────────────────────────

function ValueBody({
  value,
  unit,
  label,
  binding,
  delta,
  compact,
}: {
  value: number | string | null;
  unit: string;
  label: string;
  binding: TelemetryBinding;
  delta?: number;
  compact?: boolean;
}) {
  const decimals = binding.decimals ?? defaultDecimals(value);
  const display =
    typeof value === "number"
      ? value.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
      : value === null
        ? "—"
        : String(value);

  return (
    <div className={compact ? "px-2 py-0.5 leading-tight" : "px-3 py-1.5 leading-tight"}>
      <div
        className={
          (compact ? "text-[8.5px] mb-0 " : "text-[9.5px] mb-0.5 ") +
          "tracking-[0.06em] lowercase text-muted-foreground/75 whitespace-nowrap font-mono"
        }
      >
        {label}
      </div>
      <div className="flex items-baseline gap-1 font-mono tabular-nums whitespace-nowrap">
        <span
          className={
            (compact ? "text-[12px] " : "text-[16px] ") +
            "font-semibold leading-none"
          }
        >
          {display}
        </span>
        {unit ? (
          <span
            className={
              (compact ? "text-[8.5px] " : "text-[10px] ") +
              "opacity-55 leading-none uppercase tracking-wider"
            }
          >
            {unit}
          </span>
        ) : null}
        {/* Inline delta — hidden in compact mode to keep chips small */}
        {!compact && delta !== undefined && Math.abs(delta) > 0.005 && (
          <span className="ml-auto pl-2 text-[10px] tabular-nums opacity-55 leading-none">
            {delta > 0 ? "↑" : "↓"}
            {Math.abs(delta).toLocaleString(undefined, {
              minimumFractionDigits: Math.min(1, decimals),
              maximumFractionDigits: Math.max(1, decimals),
            })}
          </span>
        )}
      </div>
    </div>
  );
}

function StateBody({
  binding,
  value,
  label,
  compact,
}: {
  binding: TelemetryBinding;
  value: number | string | null;
  label: string;
  compact?: boolean;
}) {
  const mapped = binding.enumMap?.[value as string | number];
  const display =
    mapped?.label ??
    (value === null ? "—" : String(value).toUpperCase());
  return (
    <div
      className={
        (compact ? "px-2 py-0.5 " : "px-3 py-1.5 ") +
        "leading-tight whitespace-nowrap"
      }
    >
      <div
        className={
          (compact ? "text-[8.5px] mb-0 " : "text-[9.5px] mb-0.5 ") +
          "tracking-[0.06em] lowercase text-muted-foreground/75 font-mono"
        }
      >
        {label}
      </div>
      <div
        className={
          "font-mono font-semibold tracking-[0.04em] leading-none " +
          (compact ? "text-[10px]" : "text-[13px]")
        }
        style={mapped?.color ? { color: mapped.color } : undefined}
      >
        {display}
      </div>
    </div>
  );
}

function IndicatorBody({
  label,
  state,
}: {
  label: string;
  state: ThresholdState;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 leading-none whitespace-nowrap">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: SCHEMATIC_THEME.threshold[state].cap,
        }}
      />
      <span className="text-[10px] tracking-[0.04em] font-mono">
        {label}
      </span>
    </div>
  );
}

// ─── Extras row (Linear-style meta info) ─────────────────────────────

function ExtrasRow({
  delta,
  deltaWindowSec,
  unit,
  warn,
  critical,
  recency,
  state,
}: {
  delta?: number;
  deltaWindowSec?: number;
  unit: string;
  warn?: number;
  critical?: number;
  recency: { label: string; live: boolean } | null;
  state: ThresholdState;
}) {
  return (
    <div
      className="px-3 py-1 text-[9.5px] font-mono tabular-nums leading-none flex items-center gap-2 whitespace-nowrap"
      style={{
        borderTop: "1px solid rgba(255,255,255,0.06)",
        color: "rgba(255,255,255,0.42)",
      }}
    >
      {/* Threshold context */}
      {(warn !== undefined || critical !== undefined) && (
        <span className="flex items-center gap-1.5">
          {warn !== undefined && (
            <span>
              <span className="opacity-70">w</span>{" "}
              <span
                style={{
                  color:
                    state === "warn"
                      ? SCHEMATIC_THEME.threshold.warn.fg
                      : undefined,
                }}
              >
                {warn}
              </span>
            </span>
          )}
          {critical !== undefined && (
            <span>
              <span className="opacity-70">c</span>{" "}
              <span
                style={{
                  color:
                    state === "critical"
                      ? SCHEMATIC_THEME.threshold.critical.fg
                      : undefined,
                }}
              >
                {critical}
              </span>
            </span>
          )}
        </span>
      )}

      {/* Delta with window */}
      {delta !== undefined && Math.abs(delta) > 0.005 && deltaWindowSec && (
        <>
          <Dot />
          <span>
            {delta > 0 ? "↑" : "↓"}
            {Math.abs(delta).toFixed(unit === "%" ? 1 : 1)} / {deltaWindowSec}s
          </span>
        </>
      )}

      {/* Live recency dot */}
      {recency && (
        <span className="ml-auto pl-1 flex items-center gap-1">
          <span
            className="h-1 w-1 rounded-full"
            style={{
              background: recency.live
                ? "rgb(74, 222, 128)" // green-400
                : "rgba(255,255,255,0.4)",
            }}
          />
          <span>{recency.label}</span>
        </span>
      )}
    </div>
  );
}

function Dot() {
  return (
    <span
      className="h-[2px] w-[2px] rounded-full"
      style={{ background: "rgba(255,255,255,0.25)" }}
    />
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function labelFromMetric(metric: string): string {
  const idx = metric.indexOf(":");
  const tail = idx === -1 ? metric : metric.slice(idx + 1);
  return tail.replace(/[_\-]+/g, " ");
}

function defaultDecimals(value: number | string | null): number {
  if (typeof value !== "number") return 0;
  const abs = Math.abs(value);
  if (abs >= 1000) return 0;
  if (abs >= 10) return 1;
  return 2;
}

function formatRecency(
  ts: string | undefined,
): { label: string; live: boolean } | null {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return null;
  const ageMs = Date.now() - t;
  if (ageMs < 0) return { label: "live", live: true };
  if (ageMs < 5_000) return { label: "live", live: true };
  if (ageMs < 60_000) return { label: `${Math.round(ageMs / 1000)}s`, live: false };
  if (ageMs < 3_600_000) return { label: `${Math.round(ageMs / 60_000)}m`, live: false };
  return { label: `${Math.round(ageMs / 3_600_000)}h`, live: false };
}
