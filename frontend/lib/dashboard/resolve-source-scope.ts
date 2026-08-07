import type { DataFilter } from "@/lib/types/dashboard";

/**
 * Field names that, on a dashboard filter chip or variable, mean "scope to this
 * device/source". Matched case-insensitively.
 */
const SOURCE_FIELDS = new Set([
  "source_id",
  "source_slug",
  "source",
  "device",
  "device_id",
  "device_slug",
]);

const SOURCE_VARIABLE_NAMES = ["source", "sourceId", "source_id", "device", "deviceId"];

function isAll(value: unknown): boolean {
  const v = String(value ?? "").trim();
  return v === "" || v.toLowerCase() === "all";
}

/**
 * Resolve an effective source filter from dashboard-level scope.
 *
 * Mirrors how `usePanelData` merges dashboard filters/variables: a panel's own
 * `sourceId` always wins; otherwise we honor a dashboard-level source filter
 * chip (`source = drone-001`), then a `$source`-style dashboard variable. This
 * lets the event / alert panels — which fetch through their own hooks instead
 * of `usePanelData` — still respect the same toolbar scope as chart panels.
 *
 * Returns `undefined` when nothing scopes the source (i.e. show the whole org).
 */
export function resolveScopeSourceId(opts: {
  /** The panel's own configured source, if any — always takes precedence. */
  panelSourceId?: string | null;
  filters?: DataFilter[];
  variableValues?: Record<string, string>;
}): string | undefined {
  const { panelSourceId, filters, variableValues } = opts;

  if (panelSourceId) return panelSourceId;

  // 1. A source-equals filter chip.
  const chip = filters?.find(
    (f) =>
      f.enabled !== false &&
      SOURCE_FIELDS.has(f.field.toLowerCase()) &&
      f.operator === "=" &&
      !isAll(f.value),
  );
  if (chip) return String(chip.value);

  // 2. A dashboard variable named like a source.
  if (variableValues) {
    for (const name of SOURCE_VARIABLE_NAMES) {
      const v = variableValues[name];
      if (v && !isAll(v)) return v;
    }
  }

  return undefined;
}
