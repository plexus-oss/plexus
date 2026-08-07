"use client";

/**
 * Renders a metric inline in the Terminal using the SAME calm chart the
 * /incidents page uses (MetricPanel) — fed with live telemetry. This is the
 * "dynamic UI from our own components" payoff, matching the incidents look.
 */

import { useEffect, useState } from "react";
import { MetricPanel } from "@/components/assistant/metric-chart";
import type { MetricSeries } from "@/lib/triage/types";
import type { Panel } from "@/lib/types/dashboard";

export function InlinePanel({ panel }: { panel: Panel }) {
  const key = panel.metrics?.[0] ?? ""; // "source:metric"
  const metricName = key.split(":").slice(1).join(":") || key;
  const [series, setSeries] = useState<MetricSeries | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/telemetry/query?metrics=${encodeURIComponent(key)}&timeRange=1h`,
        );
        const json = await res.json();
        const pts = (json?.data?.[key] ?? []) as { value: number }[];
        const data = pts
          .map((p) => p.value)
          .filter((v) => typeof v === "number");
        if (!alive) return;
        setSeries({ label: metricName, current: data.at(-1) ?? 0, data });
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [key, metricName]);

  if (failed) return null;

  return (
    <div className="max-w-xs">
      {series ? (
        <MetricPanel metric={series} severity="info" />
      ) : (
        <div className="rounded-lg border border-border/60 bg-card/40 p-3 text-2xs text-muted-foreground">
          loading {metricName}…
        </div>
      )}
    </div>
  );
}
