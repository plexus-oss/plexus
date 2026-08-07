import { formatDistanceToNow } from "date-fns";

/**
 * Compact relative time — e.g. "5m", "2h", "3d", "<1m".
 *
 * Shared by the log / event / alert panels so timestamps read identically
 * everywhere. Previously this `.replace()` chain was duplicated inline in
 * list-panel and event-log-panel.
 */
export function formatRelativeShort(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  return formatDistanceToNow(d, { addSuffix: false })
    .replace("less than a minute", "<1m")
    .replace("about ", "")
    .replace("over ", "")
    .replace("almost ", "")
    .replace(" minutes", "m")
    .replace(" minute", "m")
    .replace(" hours", "h")
    .replace(" hour", "h")
    .replace(" seconds", "s")
    .replace(" second", "s")
    .replace(" days", "d")
    .replace(" day", "d")
    .replace(" months", "mo")
    .replace(" month", "mo")
    .replace(" years", "y")
    .replace(" year", "y");
}
