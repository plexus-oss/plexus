/**
 * Human one-liner for an EVENT alert, derived from its context snapshot.
 * Client-safe (no server imports) — used by the toast and the bell dropdown,
 * which only have the alerts row to work with.
 */

/** Poll bookkeeping keys — facts about the scan, not the row that arrived. */
const POLL_META_KEYS = new Set([
  "table",
  "row_count",
  "truncated",
  "first_ts",
  "last_ts",
  "latest_value",
  "filter_column",
  "filter_value",
  "violations",
  "attachments",
]);

export function eventAlertSummary(alert: {
  metric: string;
  value: number | string;
  context_snapshot?: unknown;
}): string {
  const ctx =
    alert.context_snapshot &&
    typeof alert.context_snapshot === "object" &&
    !Array.isArray(alert.context_snapshot)
      ? (alert.context_snapshot as Record<string, unknown>)
      : {};

  const rowCount = Number(alert.value);
  const more =
    Number.isFinite(rowCount) && rowCount > 1 ? ` (+${rowCount - 1} more)` : "";

  const pairs = Object.entries(ctx).filter(
    ([k, v]) =>
      !k.startsWith("_") && !POLL_META_KEYS.has(k) && typeof v !== "object",
  );
  if (pairs.length > 0) {
    return pairs.map(([k, v]) => `${k}=${String(v)}`).join(", ") + more;
  }

  const latest = ctx.latest_value;
  if (latest !== undefined && latest !== null) {
    return `${alert.metric} = ${String(latest)}${more}`;
  }

  return `Value: ${alert.value}`;
}
