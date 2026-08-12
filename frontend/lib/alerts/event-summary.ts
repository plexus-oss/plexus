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

/**
 * The alerts API enriches every row with the source's slug and display name
 * (app/api/alerts/route.ts) — the DB Row type doesn't know. Use this type
 * anywhere alerts arrive from the API.
 */
export type AlertSourceFields = {
  source_slug?: string | null;
  source_name?: string | null;
};

/**
 * One human sentence for any alert — threshold or event — usable as the
 * primary text in the list row, the bell dropdown, and the toast, so every
 * surface tells the same story. "email 1.00" tells an operator nothing;
 * "3 email events on marketing-site" is a story.
 */
export function alertSummary(
  alert: {
    metric: string;
    trigger_type?: string | null;
    value: number | string;
    threshold?: number | string | null;
    bound?: string | null;
    context_snapshot?: unknown;
  } & AlertSourceFields,
): string {
  if (alert.trigger_type === "event") {
    const detail = eventAlertSummary(alert);
    if (detail && detail !== `Value: ${alert.value}`) {
      return `${alert.metric} — ${detail}`;
    }
    const n = Number(alert.value);
    return Number.isFinite(n) && n !== 1
      ? `${n} ${alert.metric} events`
      : `${alert.metric} event`;
  }
  const value =
    typeof alert.value === "number"
      ? Number.isInteger(alert.value)
        ? String(alert.value)
        : alert.value.toFixed(2)
      : alert.value;
  if (alert.threshold != null && alert.threshold !== "") {
    const relation =
      alert.bound === "min"
        ? "below min"
        : alert.bound === "max"
          ? "over max"
          : "vs";
    return `${alert.metric} ${value} ${relation} ${alert.threshold}`;
  }
  return `${alert.metric} ${value}`;
}

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
