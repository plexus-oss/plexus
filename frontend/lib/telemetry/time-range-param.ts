/**
 * Server-side parsing of the `timeRange` query-param string used by the
 * telemetry/events API routes.
 *
 * Two forms reach these routes:
 *   - relative: "15m" | "1h" | "30d" — digits followed by s|m|h|d
 *   - absolute: "<startISO>/<endISO>" — the form committed by the dashboard
 *     mini-scrubber and the custom date-range picker (the end is optional and
 *     defaults to now)
 *
 * The routes historically only matched the relative form, so any absolute
 * range silently fell through to a default ("last 1 hour"), making a panel
 * report "no data" for a window the scrubber clearly showed data in. Centralize
 * the parsing here so every route handles both consistently.
 *
 * Unrecognized input falls back to `defaultRelative` rather than collapsing to a
 * surprise window.
 */

import { parseRelativeTime } from "@/lib/types/dashboard";

const RELATIVE_RE = /^(\d+)([smhd])$/;

/** True when the string is an absolute "<startISO>/<endISO>" range. */
export function isAbsoluteTimeRange(timeRange: string): boolean {
  return timeRange.includes("/");
}

/**
 * Resolve a `timeRange` query-param string to an absolute [startTime, endTime]
 * window. `defaultRelative` is used when the string is neither a valid relative
 * range nor a parseable absolute range.
 */
export function parseTimeRangeParam(
  timeRange: string,
  defaultRelative = "1h",
): { startTime: Date; endTime: Date } {
  if (isAbsoluteTimeRange(timeRange)) {
    const [startStr, endStr] = timeRange.split("/");
    const start = new Date(startStr);
    const end = endStr ? new Date(endStr) : new Date();
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return { startTime: start, endTime: end };
    }
    // Malformed ISO — fall through to the relative default below.
  }

  const end = new Date();
  const spec = RELATIVE_RE.test(timeRange) ? timeRange : defaultRelative;
  return {
    startTime: new Date(end.getTime() - parseRelativeTime(spec)),
    endTime: end,
  };
}

/** Span of a `timeRange` string in milliseconds (relative or absolute). */
export function timeRangeSpanMs(timeRange: string, defaultRelative = "1h"): number {
  const { startTime, endTime } = parseTimeRangeParam(timeRange, defaultRelative);
  return endTime.getTime() - startTime.getTime();
}
