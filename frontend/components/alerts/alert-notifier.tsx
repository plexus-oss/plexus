"use client";

/**
 * Alert Notifier
 *
 * Invisible component that toasts new alerts as they arrive. Listens to the
 * realtime stream (/api/realtime/stream) for `alerts` INSERT events — so a toast
 * fires the moment an alert is created server-side, and never on a page reload
 * for alerts that already existed. The event carries only the id, so we hydrate
 * the alert via GET /api/alerts/[id] before toasting. Catch-up for missed alerts
 * is the inbox (bell dropdown), not this component.
 */

import { useCallback, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { usePlexusSession } from "@/hooks/use-plexus-session";
import { toast } from "sonner";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import { useRealtimeEvents, type RowChangeEvent } from "@/lib/realtime/use-realtime-events";
import type { Alert, LimitSeverity } from "@/lib/db/types";

// /shared can be viewed by signed-in users from a different org — pathname
// check keeps us from leaking the viewer's own alerts onto a share page.
const PUBLIC_ROUTES = ["/shared", "/sign-in", "/sign-up"];

interface AlertNotifierProps {
  /** Only toast for alerts from this source */
  sourceId?: string;
  /** Disable notifications (useful for pages that show alerts inline) */
  disabled?: boolean;
}

const severityConfig: Record<
  LimitSeverity,
  {
    icon: typeof AlertTriangle;
    color: string;
    toastType: "error" | "warning" | "info";
  }
> = {
  critical: { icon: AlertTriangle, color: "text-red-500", toastType: "error" },
  warning: {
    icon: AlertCircle,
    color: "text-yellow-500",
    toastType: "warning",
  },
  info: { icon: Info, color: "text-blue-500", toastType: "info" },
};

export function AlertNotifier({ sourceId, disabled }: AlertNotifierProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isSignedIn, orgId } = usePlexusSession();
  const isPublicRoute = PUBLIC_ROUTES.some((route) =>
    pathname?.startsWith(route),
  );
  const isEnabled = !!isSignedIn && !!orgId && !isPublicRoute && !disabled;

  // Capture the time the subscription begins. NOTIFY only delivers events that
  // happen after we connect, but we double-check against the alert's
  // triggered_at as a belt-and-suspenders guard against any historical event
  // leaking through (e.g., on reconnect).
  const subscribedAtRef = useRef<number>(0);
  useEffect(() => {
    if (isEnabled) subscribedAtRef.current = Date.now();
  }, [isEnabled]);

  const onRowChange = useCallback(
    async (ev: RowChangeEvent) => {
      if (ev.table !== "alerts" || ev.op !== "INSERT" || !ev.id) return;
      // The event carries only the id; hydrate the full alert to render the toast.
      try {
        const res = await fetch(`/api/alerts/${ev.id}`);
        if (!res.ok) return;
        const { alert } = (await res.json()) as { alert?: Alert };
        if (!alert) return;
        if (sourceId && alert.source_id !== sourceId) return;
        const triggeredMs = alert.triggered_at
          ? new Date(alert.triggered_at).getTime()
          : 0;
        if (triggeredMs && triggeredMs < subscribedAtRef.current - 5_000) {
          // Older than our subscription window — treat as historical, skip.
          return;
        }
        showAlertToast(alert, router);
      } catch {
        // Network/parse error — drop the toast; the inbox is the catch-up path.
      }
    },
    [sourceId, router],
  );

  useRealtimeEvents(onRowChange, isEnabled);

  return null;
}

function showAlertToast(alert: Alert, router: ReturnType<typeof useRouter>) {
  const config = severityConfig[alert.severity] || severityConfig.warning;
  const Icon = config.icon;

  const metricName = alert.metric
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  let description: string;
  if (alert.trigger_type === "event") {
    description = `Value: ${alert.value}`;
  } else if (alert.threshold != null) {
    const comparison = alert.bound === "max" ? ">" : "<";
    description = `${alert.value} ${comparison} ${alert.threshold}`;
  } else {
    description = `Value: ${alert.value}`;
  }

  toast[config.toastType](metricName, {
    description,
    duration: alert.severity === "critical" ? 10000 : 6000,
    action: {
      label: "View",
      onClick: () => {
        router.push(`/alerts?selected=${alert.id}`);
      },
    },
    icon: <Icon className={`h-4 w-4 ${config.color}`} />,
  });
}
