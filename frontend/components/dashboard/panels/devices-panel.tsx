"use client";

/**
 * Devices mini-panel.
 *
 * Embeds a filtered view of the devices page. No SQL required — uses the
 * same `useSources` hook that powers /devices.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { useSources } from "@/hooks/use-sources";
import { Spinner } from "@/components/ui/spinner";
import { PanelEmptyState } from "@/components/dashboard/panels/panel-empty-state";
import type { Panel } from "@/lib/types/dashboard";
import { cn } from "@/lib/utils";

interface DevicesPanelProps {
  panel: Panel;
}

interface DevicesPanelConfig {
  statusFilter?: Array<"online" | "offline" | "pending" | "error" | "unknown">;
  deviceType?: string;
  search?: string;
  limit?: number;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "online"
      ? "bg-emerald-500"
      : status === "error"
        ? "bg-red-500"
        : status === "pending"
          ? "bg-amber-500"
          : "bg-muted-foreground/40";
  return <span className={cn("h-2 w-2 rounded-full shrink-0", color)} />;
}

export function DevicesPanel({ panel }: DevicesPanelProps) {
  const router = useRouter();
  const config = useMemo(
    () => (panel.config as unknown as DevicesPanelConfig) ?? {},
    [panel.config],
  );
  const { devices, isLoading } = useSources({ type: "device" });

  const filtered = useMemo(() => {
    let out = devices;
    if (config.statusFilter && config.statusFilter.length > 0) {
      const set = new Set(config.statusFilter);
      out = out.filter((d) => set.has(d.status as (typeof config.statusFilter)[number]));
    }
    if (config.deviceType) {
      out = out.filter((d) => d.device_type === config.deviceType);
    }
    if (config.search) {
      const q = config.search.toLowerCase();
      out = out.filter(
        (d) =>
          d.slug.toLowerCase().includes(q) ||
          d.name?.toLowerCase().includes(q) ||
          d.device_type?.toLowerCase().includes(q),
      );
    }
    if (config.limit && config.limit > 0) {
      out = out.slice(0, config.limit);
    }
    return out;
  }, [devices, config]);

  if (isLoading && devices.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (filtered.length === 0) {
    return <PanelEmptyState reason="no_data" />;
  }

  return (
    <div className="h-full overflow-auto">
      <ul className="divide-y divide-border/40">
        {filtered.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => router.push(`/devices/${d.slug}`)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 text-left",
                "hover:bg-muted/50 transition-colors",
              )}
            >
              <StatusDot status={d.status} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">
                  {d.name || d.slug}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {d.device_type ?? "device"}
                  {d.last_seen_at && (
                    <>
                      {" · "}
                      {formatDistanceToNow(new Date(d.last_seen_at), {
                        addSuffix: true,
                      })}
                    </>
                  )}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
