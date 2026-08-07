/**
 * Shared configuration for alert severity and status styling
 * Used across alert-list, alert-detail-sheet, and other alert-related components
 */

import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertStatus = "open" | "acknowledged" | "resolved";

interface SeverityConfig {
  icon: LucideIcon;
  color: string;
  bg: string;
  badge: string;
}

interface StatusConfig {
  label: string;
  color: string;
}

export const severityConfig: Record<AlertSeverity, SeverityConfig> = {
  critical: {
    icon: AlertTriangle,
    color: "text-red-500",
    bg: "bg-red-500/10",
    badge: "bg-red-500/20 text-red-500 border-red-500/30",
  },
  warning: {
    icon: AlertCircle,
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
    badge: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
  },
  info: {
    icon: Info,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    badge: "bg-blue-500/20 text-blue-500 border-blue-500/30",
  },
};

export const statusConfig: Record<AlertStatus, StatusConfig> = {
  open: {
    label: "Open",
    color: "bg-foreground/10 text-foreground/80 border-foreground/20",
  },
  acknowledged: {
    label: "Acknowledged",
    color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
  resolved: {
    label: "Resolved",
    color: "bg-muted text-muted-foreground border-border",
  },
};
