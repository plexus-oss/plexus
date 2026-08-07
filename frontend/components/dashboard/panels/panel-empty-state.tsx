"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  formatDateTimeInZone,
} from "@/lib/timezone";
import { useFormattedTime } from "@/hooks/use-formatted-time";
import {
  Database,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Table2,
  Wifi,
  WifiOff,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type EmptyStateReason =
  | "no_data" // Query succeeded but returned no rows
  | "no_data_in_range" // Data exists but not in selected time range
  | "query_error" // Query failed
  | "loading" // Still loading
  | "no_source" // No data source configured
  | "no_metrics" // No metrics selected
  | "transform_failed" // Data exists but couldn't be transformed for chart
  | "connection_offline"; // Connection source is offline

interface DataDebugInfo {
  // Query info
  queryExecuted?: string;
  queryTimeMs?: number;
  rowCount?: number;
  columnCount?: number;
  columns?: string[];

  // Time range info
  requestedTimeRange?: { start: string; end: string };
  actualDataRange?: { earliest: string; latest: string };

  // Source info
  sourceType?: "realtime" | "table" | "connection";
  sourceName?: string;
  sourceStatus?: "online" | "offline" | "unknown";

  // Error info
  errorMessage?: string;
}

interface PanelEmptyStateProps {
  reason: EmptyStateReason;
  debugInfo?: DataDebugInfo;
  onRetry?: () => void;
  onExpandTimeRange?: () => void;
  className?: string;
}

const REASON_CONFIG: Record<
  EmptyStateReason,
  {
    icon: typeof Database;
    title: string;
    color: string;
  }
> = {
  no_data: {
    icon: Database,
    title: "No data",
    color: "text-muted-foreground",
  },
  no_data_in_range: {
    icon: Clock,
    title: "No data in time range",
    color: "text-yellow-500",
  },
  query_error: {
    icon: XCircle,
    title: "Query failed",
    color: "text-destructive",
  },
  loading: {
    icon: Database,
    title: "Loading...",
    color: "text-muted-foreground",
  },
  no_source: {
    icon: HelpCircle,
    title: "No data source",
    color: "text-muted-foreground",
  },
  no_metrics: {
    icon: HelpCircle,
    title: "No metrics selected",
    color: "text-muted-foreground",
  },
  transform_failed: {
    icon: AlertCircle,
    title: "Data format issue",
    color: "text-yellow-500",
  },
  connection_offline: {
    icon: WifiOff,
    title: "Connection offline",
    color: "text-destructive",
  },
};

export function PanelEmptyState({
  reason,
  debugInfo,
  onRetry,
  onExpandTimeRange,
  className,
}: PanelEmptyStateProps) {
  const [showDebug, setShowDebug] = useState(false);
  const { timezone, use12Hour } = useFormattedTime();
  const config = REASON_CONFIG[reason];
  const Icon = config.icon;

  const getMessage = () => {
    switch (reason) {
      case "no_data":
        if (debugInfo?.sourceType === "connection") {
          const rowCount = debugInfo.rowCount ?? 0;
          if (rowCount > 0) {
            return `Query returned ${rowCount} rows but data couldn't be displayed`;
          }
          return `Query returned 0 rows from ${debugInfo.sourceName || "connection"}`;
        }
        return "The query executed successfully but returned no data";

      case "no_data_in_range":
        if (debugInfo?.actualDataRange) {
          return `Data exists from ${formatTime(debugInfo.actualDataRange.earliest, timezone, use12Hour)} to ${formatTime(debugInfo.actualDataRange.latest, timezone, use12Hour)}, but your time range is ${formatTimeRange(debugInfo.requestedTimeRange, timezone, use12Hour)}`;
        }
        return "Data exists but not within the selected time range";

      case "query_error":
        return debugInfo?.errorMessage || "Failed to execute query";

      case "no_source":
        return "Configure a data source for this panel";

      case "no_metrics":
        return "Select metrics or columns to display";

      case "transform_failed":
        if (debugInfo?.rowCount && debugInfo.rowCount > 0) {
          return `Retrieved ${debugInfo.rowCount} rows but couldn't transform to chart format. Check column types.`;
        }
        return "Data was retrieved but couldn't be displayed as a chart";

      case "connection_offline":
        return `Connection "${debugInfo?.sourceName || "unknown"}" is offline. Test the connection first.`;

      default:
        return "No data available";
    }
  };

  const getSuggestions = (): string[] => {
    const suggestions: string[] = [];

    switch (reason) {
      case "no_data":
        if (debugInfo?.sourceType === "connection") {
          suggestions.push("Verify the table has data");
          suggestions.push("Check the query in panel settings");
        } else {
          suggestions.push("Check that data is being collected");
          suggestions.push("Verify the source is online");
        }
        break;

      case "no_data_in_range":
        suggestions.push("Jump to where the data is, or widen the time range");
        if (debugInfo?.actualDataRange?.latest) {
          suggestions.push(
            `Try selecting a range that includes ${formatTime(debugInfo.actualDataRange.latest, timezone, use12Hour)}`,
          );
        }
        break;

      case "transform_failed":
        suggestions.push(
          "Ensure there's a timestamp column for time-series charts",
        );
        suggestions.push("Check that numeric columns contain valid numbers");
        suggestions.push("Try using a Data Grid panel to see raw data");
        break;

      case "query_error":
        suggestions.push("Check the query syntax");
        suggestions.push("Verify table and column names");
        break;

      case "connection_offline":
        suggestions.push("Go to Sources and test the connection");
        suggestions.push("Check database credentials");
        break;
    }

    return suggestions;
  };

  return (
    <div
      className={cn(
        "h-full flex flex-col items-center justify-center p-4 text-center",
        className,
      )}
    >
      <Icon className={cn("h-8 w-8 mb-2", config.color)} />
      <p className={cn("text-sm font-medium", config.color)}>{config.title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">
        {getMessage()}
      </p>

      {/* Suggestions */}
      {getSuggestions().length > 0 && (
        <ul className="mt-3 text-xs text-muted-foreground space-y-1">
          {getSuggestions()
            .slice(0, 2)
            .map((suggestion, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-muted-foreground/50">•</span>
                {suggestion}
              </li>
            ))}
        </ul>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-3">
        {reason === "no_data_in_range" && onExpandTimeRange && (
          <Button size="sm" variant="outline" onClick={onExpandTimeRange}>
            <Clock className="h-3 w-3 mr-1" />
            Jump to data
          </Button>
        )}
        {(reason === "query_error" || reason === "connection_offline") &&
          onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          )}
      </div>

      {/* Debug Info Toggle */}
      {debugInfo && (
        <button
          onClick={() => setShowDebug(!showDebug)}
          className="flex items-center gap-1 mt-3 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {showDebug ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          Debug info
        </button>
      )}

      {/* Debug Panel */}
      {showDebug && debugInfo && (
        <div className="mt-2 p-2 rounded bg-muted/50 text-[10px] text-left w-full max-w-[320px] space-y-1.5 font-mono">
          {/* Source Info */}
          <div className="flex items-center gap-2">
            {debugInfo.sourceType === "connection" ? (
              <Database className="h-3 w-3" />
            ) : debugInfo.sourceType === "table" ? (
              <Table2 className="h-3 w-3" />
            ) : (
              <Wifi className="h-3 w-3" />
            )}
            <span className="text-muted-foreground">Source:</span>
            <span>
              {debugInfo.sourceName || debugInfo.sourceType || "unknown"}
            </span>
            {debugInfo.sourceStatus && (
              <span
                className={cn(
                  "ml-auto",
                  debugInfo.sourceStatus === "online"
                    ? "text-green-500"
                    : "text-red-500",
                )}
              >
                {debugInfo.sourceStatus === "online" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <XCircle className="h-3 w-3" />
                )}
              </span>
            )}
          </div>

          {/* Query Info */}
          {debugInfo.queryExecuted && (
            <div>
              <span className="text-muted-foreground">Query:</span>
              <div className="mt-0.5 p-1 bg-background rounded text-[9px] overflow-x-auto whitespace-nowrap">
                {debugInfo.queryExecuted.length > 100
                  ? debugInfo.queryExecuted.slice(0, 100) + "..."
                  : debugInfo.queryExecuted}
              </div>
            </div>
          )}

          {/* Results */}
          <div className="flex gap-4">
            {debugInfo.rowCount !== undefined && (
              <div>
                <span className="text-muted-foreground">Rows:</span>{" "}
                <span
                  className={debugInfo.rowCount === 0 ? "text-yellow-500" : ""}
                >
                  {debugInfo.rowCount}
                </span>
              </div>
            )}
            {debugInfo.queryTimeMs !== undefined && (
              <div>
                <span className="text-muted-foreground">Time:</span>{" "}
                {debugInfo.queryTimeMs}ms
              </div>
            )}
          </div>

          {/* Columns */}
          {debugInfo.columns && debugInfo.columns.length > 0 && (
            <div>
              <span className="text-muted-foreground">Columns:</span>{" "}
              <span className="text-[9px]">
                {debugInfo.columns.slice(0, 5).join(", ")}
                {debugInfo.columns.length > 5 &&
                  ` +${debugInfo.columns.length - 5} more`}
              </span>
            </div>
          )}

          {/* Time Range */}
          {debugInfo.requestedTimeRange && (
            <div>
              <span className="text-muted-foreground">Time range:</span>{" "}
              {formatTimeRange(debugInfo.requestedTimeRange, timezone, use12Hour)}
            </div>
          )}
          {debugInfo.actualDataRange && (
            <div>
              <span className="text-muted-foreground">Data range:</span>{" "}
              {formatTime(debugInfo.actualDataRange.earliest, timezone, use12Hour)} -{" "}
              {formatTime(debugInfo.actualDataRange.latest, timezone, use12Hour)}
            </div>
          )}

          {/* Error */}
          {debugInfo.errorMessage && (
            <div className="text-destructive">
              <span className="text-muted-foreground">Error:</span>{" "}
              {debugInfo.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string | undefined, timezone?: string, use12Hour?: boolean): string {
  if (!iso) return "unknown";
  try {
    return formatDateTimeInZone(new Date(iso), timezone ?? "UTC", use12Hour ?? false);
  } catch {
    return iso;
  }
}

function formatTimeRange(
  range: { start: string; end: string } | undefined,
  timezone?: string,
  use12Hour?: boolean,
): string {
  if (!range) return "unknown";
  return `${formatTime(range.start, timezone, use12Hour)} - ${formatTime(range.end, timezone, use12Hour)}`;
}
