"use client";

/**
 * AttitudeConfigurator — artificial-horizon style indicator.
 *
 * Pick a device; auto-detect roll/pitch/yaw from its metric names
 * (case-insensitive substring match). Auto-detected bindings are stored
 * as ordered `metrics` (roll, pitch, yaw) so the renderer can read them
 * positionally, and individually in `config.attitude` so users can
 * override one role without losing the others.
 */

import { useEffect, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { useAvailableMetrics } from "@/hooks/use-telemetry";
import { usePlexusRealtime } from "@/hooks/use-plexus-realtime";
import { InlineSourcePicker } from "./inline-source-picker";
import type { ConfiguratorProps } from "./types";

type Role = "roll" | "pitch" | "yaw";
const ROLES: Role[] = ["roll", "pitch", "yaw"];

interface AttitudeBinding {
  roll?: string;
  pitch?: string;
  yaw?: string;
}

function detectRole(metric: string, role: Role): boolean {
  return metric.toLowerCase().includes(role);
}

function autoDetect(metrics: string[]): AttitudeBinding {
  const out: AttitudeBinding = {};
  for (const role of ROLES) {
    const match = metrics.find((m) => detectRole(m, role));
    if (match) out[role] = match;
  }
  return out;
}

export function AttitudeConfigurator({
  draft,
  onChange,
  onValidChange,
}: ConfiguratorProps) {
  const binding = draft.config.attitude ?? {};
  const sourceId = draft.config.sourceId;

  const { metricsBySource } = useAvailableMetrics();
  const { sources: rtSources } = usePlexusRealtime();

  const availableMetricsForSource = useMemo(() => {
    if (!sourceId) return [];
    const out = new Set<string>();
    for (const s of metricsBySource) {
      if (s.source_id === sourceId) for (const m of s.metrics) out.add(m);
    }
    for (const rt of rtSources) {
      if (rt.source_id !== sourceId) continue;
      for (const sensor of rt.sensors ?? []) {
        if (sensor.available && sensor.metrics) {
          for (const m of sensor.metrics) out.add(m);
        }
      }
    }
    return Array.from(out);
  }, [sourceId, metricsBySource, rtSources]);

  const isValid = !!(sourceId && binding.roll && binding.pitch && binding.yaw);

  useEffect(() => {
    onValidChange(isValid);
  }, [isValid, onValidChange]);

  const pickSource = (newSource: string | undefined) => {
    if (!newSource) {
      onChange({
        ...draft,
        metrics: [],
        dataSource: { type: "realtime" },
        config: {
          ...draft.config,
          sourceId: undefined,
          attitude: undefined,
        },
      });
      return;
    }
    // Auto-detect roll/pitch/yaw from the source's known metrics.
    const detected = autoDetect(availableMetricsForSource);
    const keyed: AttitudeBinding = {
      roll: detected.roll ? `${newSource}:${detected.roll}` : undefined,
      pitch: detected.pitch ? `${newSource}:${detected.pitch}` : undefined,
      yaw: detected.yaw ? `${newSource}:${detected.yaw}` : undefined,
    };
    const ordered = [keyed.roll, keyed.pitch, keyed.yaw].filter(
      (m): m is string => !!m,
    );
    onChange({
      ...draft,
      metrics: ordered,
      dataSource: { type: "realtime" },
      config: {
        ...draft.config,
        sourceId: newSource,
        attitude: keyed,
      },
    });
  };

  const overrideRole = (role: Role, metricName: string) => {
    if (!sourceId) return;
    const next: AttitudeBinding = {
      ...binding,
      [role]: `${sourceId}:${metricName}`,
    };
    const ordered = [next.roll, next.pitch, next.yaw].filter(
      (m): m is string => !!m,
    );
    onChange({
      ...draft,
      metrics: ordered,
      config: { ...draft.config, attitude: next },
    });
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <div>
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Device
        </Label>
        <div className="mt-1 h-40 flex">
          <InlineSourcePicker
            mode="single"
            selected={sourceId ? [sourceId] : []}
            onChange={(s) => pickSource(s[0])}
            className="flex-1"
          />
        </div>
      </div>

      {sourceId && (
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Roles
          </Label>
          {ROLES.map((role) => {
            const value = binding[role];
            const justMetric = value
              ? value.substring(value.indexOf(":") + 1)
              : "";
            return (
              <div key={role} className="flex items-center gap-2 text-[11px]">
                <span className="w-12 text-muted-foreground uppercase tracking-wide text-[10px]">
                  {role}
                </span>
                <select
                  value={justMetric}
                  onChange={(e) => overrideRole(role, e.target.value)}
                  className="flex-1 h-7 rounded border border-input bg-background px-2 text-[11px]"
                >
                  <option value="" disabled>
                    Not set
                  </option>
                  {availableMetricsForSource.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          {!binding.roll || !binding.pitch || !binding.yaw ? (
            <p className="text-[10px] text-muted-foreground">
              No match for one or more roles — pick manually above.
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Auto-detected. Override above if needed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
