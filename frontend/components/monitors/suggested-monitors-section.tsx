"use client";

import { MonitorSuggestionBanner } from "@/components/monitors/monitor-suggestion-banner";
import { useSources } from "@/hooks/use-sources";

export function SuggestedMonitorsSection() {
  const { sources } = useSources({ type: "device", status: "online" });

  if (sources.length === 0) return null;

  return (
    <div className="space-y-2 mb-2">
      {sources.map((device) => (
        <MonitorSuggestionBanner
          key={device.id}
          sourceId={device.id}
          sourceName={device.name || device.slug}
        />
      ))}
    </div>
  );
}
