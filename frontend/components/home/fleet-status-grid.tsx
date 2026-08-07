"use client";

import { Circle, AlertTriangle, Activity, HeartPulse } from "lucide-react";
import { Sparkline } from "@/components/ui/sparkline";
import { useSources } from "@/hooks/use-sources";
import { useAlerts } from "@/hooks/use-alerts";
import { useFleetHealth } from "@/hooks/use-fleet-health";
import { cn } from "@/lib/utils";

interface StatusCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  detail?: React.ReactNode;
  sparklineData?: number[];
  trend?: "up" | "down" | "flat";
  alert?: boolean;
}

function StatusCard({
  icon,
  label,
  value,
  detail,
  sparklineData,
  trend,
  alert,
}: StatusCardProps) {
  return (
    <div
      className={cn(
        "p-3 rounded-lg border border-border/50 bg-muted/20 space-y-2 relative overflow-hidden",
        alert && "border-red-500/30",
      )}
    >
      {alert && (
        <div className="absolute inset-0 bg-red-500/5 animate-pulse pointer-events-none" />
      )}
      <div className="flex items-center justify-between relative">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        {sparklineData && sparklineData.length >= 2 && (
          <Sparkline data={sparklineData} trend={trend} width={48} height={16} />
        )}
      </div>
      <div className="flex items-end justify-between relative">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {detail}
      </div>
    </div>
  );
}

export function FleetStatusGrid() {
  const { sources } = useSources();
  const { alerts } = useAlerts({ status: "open" });
  const { summary, fleet } = useFleetHealth();

  const onlineCount = sources.filter((s) => s.status === "online").length;
  const totalDevices = sources.length;

  const criticalAlerts = alerts.filter((a) => a.severity === "critical").length;
  const warningAlerts = alerts.filter((a) => a.severity === "warning").length;
  const hasCritical = criticalAlerts > 0;

  // Compute data health: % of devices that have reported data
  const reportingDevices = fleet.filter(
    (f) => f.point_count > 0,
  ).length;
  const dataHealth =
    totalDevices > 0 ? Math.round((reportingDevices / totalDevices) * 100) : 0;

  return (
    <div className="grid grid-cols-2 gap-2">
      <StatusCard
        icon={<Circle className="h-3.5 w-3.5" />}
        label="Devices"
        value={totalDevices}
        detail={
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {onlineCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {onlineCount}
              </span>
            )}
            {totalDevices - onlineCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                {totalDevices - onlineCount}
              </span>
            )}
          </div>
        }
      />
      <StatusCard
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
        label="Alerts"
        value={alerts.length}
        alert={hasCritical}
        detail={
          alerts.length > 0 ? (
            <div className="flex items-center gap-2 text-[10px]">
              {criticalAlerts > 0 && (
                <span className="text-red-400">{criticalAlerts} critical</span>
              )}
              {warningAlerts > 0 && (
                <span className="text-amber-400">{warningAlerts} warning</span>
              )}
            </div>
          ) : (
            <span className="text-[10px] text-green-500">All clear</span>
          )
        }
      />
      <StatusCard
        icon={<Activity className="h-3.5 w-3.5" />}
        label="Throughput"
        value={summary.totalPoints.toLocaleString()}
        detail={
          <span className="text-[10px] text-muted-foreground">points</span>
        }
      />
      <StatusCard
        icon={<HeartPulse className="h-3.5 w-3.5" />}
        label="Data Health"
        value={`${dataHealth}%`}
        detail={
          <span className="text-[10px] text-muted-foreground">
            {reportingDevices}/{totalDevices} reporting
          </span>
        }
      />
    </div>
  );
}
