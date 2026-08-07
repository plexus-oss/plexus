export type ValueNotation = "standard" | "scientific";

/**
 * Format a value per the shared Decimals/Notation panel config. Returns
 * undefined when neither is set so callers fall back to their own default
 * (e.g. the adaptive `formatValue` in base-chart).
 */
export function formatPanelValue(
  value: number,
  decimals?: number,
  notation?: ValueNotation,
): string | undefined {
  if (notation === "scientific") return value.toExponential(decimals ?? 2);
  if (decimals !== undefined) return value.toFixed(decimals);
  return undefined;
}
