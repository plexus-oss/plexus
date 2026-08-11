"use client";

/**
 * Alerts Dropdown Component
 *
 * Bell icon with notification badge that shows open alerts in a dropdown.
 * Clicking an alert opens its detail page; hovering reveals an inline
 * dismiss (acknowledge) action. The badge pulses only for alerts that
 * arrived after the user last opened the dropdown.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Bell,
  AlertTriangle,
  AlertCircle,
  Info,
  ExternalLink,
  CheckCheck,
  X,
} from "lucide-react";
import { useAlerts } from "@/hooks/use-alerts";
import { fetcher } from "@/lib/fetcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDateInZone } from "@/lib/timezone";
import { eventAlertSummary } from "@/lib/alerts/event-summary";
import type { Alert } from "@/lib/db/types";

const ALERTS_LAST_SEEN_URL = "/api/notifications/alerts-last-seen";

/** Format a date as relative time (e.g., "2 min ago", "1 hour ago") */
function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDateInZone(then, "UTC", "short");
}

interface AlertsDropdownProps {
  collapsed?: boolean;
}

function getSeverityIcon(severity: string) {
  switch (severity) {
    case "critical":
      return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
    case "warning":
      return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />;
    default:
      return <Info className="h-3.5 w-3.5 text-blue-500" />;
  }
}

function getSeverityBadgeClass(severity: string) {
  switch (severity) {
    case "critical":
      return "bg-red-500/10 text-red-500 border-red-500/20";
    case "warning":
      return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
    default:
      return "bg-blue-500/10 text-blue-500 border-blue-500/20";
  }
}

function AlertItem({
  alert,
  onOpen,
  onDismiss,
}: {
  alert: Alert;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const description = alert.threshold
    ? `Value ${alert.value} ${alert.bound === "max" ? "exceeded" : "below"} threshold ${alert.threshold}`
    : alert.trigger_type === "event"
      ? eventAlertSummary(alert)
      : `Value: ${alert.value}`;

  const handleDismiss = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDismiss();
  };

  return (
    <DropdownMenuItem
      onClick={onOpen}
      className="group relative flex flex-col items-start gap-1 p-3 cursor-pointer focus:bg-muted data-[dismissing=true]:opacity-0 data-[dismissing=true]:-translate-x-2 transition-all duration-150"
    >
      <div className="flex items-center gap-2 w-full pr-6">
        {getSeverityIcon(alert.severity)}
        <span className="text-xs font-medium flex-1 truncate">
          {alert.metric}
        </span>
        <span
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded border",
            getSeverityBadgeClass(alert.severity),
          )}
        >
          {alert.severity}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground line-clamp-2 pl-5 pr-6">
        {description}
      </p>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground pl-5">
        {alert.source_id && <span>{alert.source_id}</span>}
        {alert.source_id && <span>&middot;</span>}
        <span>{formatRelativeTime(alert.triggered_at)}</span>
      </div>
      <button
        type="button"
        aria-label="Dismiss alert"
        onClick={handleDismiss}
        className={cn(
          "absolute top-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded",
          "text-muted-foreground/60 hover:text-foreground hover:bg-accent",
          "opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity",
        )}
      >
        <X className="h-3 w-3" />
      </button>
    </DropdownMenuItem>
  );
}

export function AlertsDropdown({ collapsed = false }: AlertsDropdownProps) {
  void collapsed;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const { alerts, counts, isLoading, acknowledgeAlert, acknowledgeAll } =
    useAlerts({
      status: ["open"],
      limit: 5,
      refreshInterval: 30_000,
    });

  const openCount = counts.open || 0;
  const hasAlerts = alerts.length > 0;

  // Last-seen timestamp lives server-side so it syncs across browsers/devices.
  // The badge pulses when any open alert has triggered_at > alertsLastSeenAt.
  const { data: lastSeenData, mutate: mutateLastSeen } = useSWR<{
    alertsLastSeenAt: string | null;
  }>(ALERTS_LAST_SEEN_URL, fetcher);

  const lastSeenAt = useMemo(() => {
    const raw = lastSeenData?.alertsLastSeenAt;
    return raw ? new Date(raw).getTime() : 0;
  }, [lastSeenData]);

  const newestAlertAt = useMemo(() => {
    if (!alerts.length) return 0;
    return alerts.reduce((max, a) => {
      const t = new Date(a.triggered_at).getTime();
      return t > max ? t : max;
    }, 0);
  }, [alerts]);

  const hasNewSinceSeen = openCount > 0 && newestAlertAt > lastSeenAt;

  // Mark as seen on the server whenever the dropdown is opened.
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) {
      const nowIso = new Date().toISOString();
      mutateLastSeen(
        async () => {
          const res = await fetch(ALERTS_LAST_SEEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ at: nowIso }),
          });
          if (!res.ok) throw new Error("Failed to mark seen");
          return res.json();
        },
        {
          optimisticData: { alertsLastSeenAt: nowIso },
          rollbackOnError: true,
          revalidate: false,
        },
      ).catch(() => {
        // Non-fatal: badge will still pulse, user can retry by reopening.
      });
    }
    prevOpen.current = open;
  }, [open, mutateLastSeen]);

  const handleAlertOpen = (alertId: string) => {
    setOpen(false);
    router.push(`/alerts?selected=${alertId}`);
  };

  const handleViewAll = () => {
    setOpen(false);
    router.push("/alerts");
  };

  const handleDismissOne = useCallback(
    (alertId: string) => {
      void acknowledgeAlert(alertId, { silent: true });
    },
    [acknowledgeAlert],
  );

  const handleMarkAllRead = useCallback(async () => {
    if (openCount === 0 || isMarkingRead) return;
    setIsMarkingRead(true);
    try {
      await acknowledgeAll();
    } finally {
      setIsMarkingRead(false);
    }
  }, [acknowledgeAll, isMarkingRead, openCount]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative h-7 w-7 rounded-md",
            "hover:bg-gray-100 dark:hover:bg-zinc-900",
            "focus-visible:ring-1 focus-visible:ring-ring",
          )}
          title={openCount > 0 ? `${openCount} open alerts` : "Alerts"}
        >
          <Bell className="h-3.5 w-3.5 text-muted-foreground" />
          {openCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center">
              {hasNewSinceSeen && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
              )}
              <span
                className={cn(
                  "relative inline-flex h-3 w-3 items-center justify-center rounded-full text-[8px] font-semibold text-white",
                  hasNewSinceSeen ? "bg-red-500" : "bg-muted-foreground/80",
                )}
              >
                {openCount > 9 ? "9+" : openCount}
              </span>
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="right"
        className="w-80"
        sideOffset={8}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-medium">Alerts</span>
          {openCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleMarkAllRead();
              }}
              disabled={isMarkingRead}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground h-auto p-0"
            >
              <CheckCheck className="h-3 w-3" />
              {isMarkingRead ? "Marking..." : "Mark all read"}
            </Button>
          )}
        </div>

        {isLoading && !hasAlerts ? (
          <div className="p-4 text-center">
            <span className="text-xs text-muted-foreground">Loading...</span>
          </div>
        ) : hasAlerts ? (
          <div className="max-h-[320px] overflow-y-auto">
            {alerts.map((alert) => (
              <AlertItem
                key={alert.id}
                alert={alert}
                onOpen={() => handleAlertOpen(alert.id)}
                onDismiss={() => handleDismissOne(alert.id)}
              />
            ))}
            {openCount > alerts.length && (
              <div className="px-3 py-2 text-[10px] text-muted-foreground text-center border-t border-border">
                {openCount - alerts.length} more open{" "}
                {openCount - alerts.length === 1 ? "alert" : "alerts"}
              </div>
            )}
          </div>
        ) : (
          <div className="p-6 text-center">
            <Bell className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No active alerts</p>
          </div>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleViewAll}
          className="flex items-center justify-center gap-1.5 p-2 text-xs text-primary cursor-pointer"
        >
          View all alerts
          <ExternalLink className="h-3 w-3" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
