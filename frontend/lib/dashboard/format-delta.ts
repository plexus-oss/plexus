/**
 * Human-compact duration formatting for the pinned-time-tracker Δt readout.
 *
 * Magnitude only — callers own the sign/direction glyph. Two units max, and
 * sub-minute values keep decimal precision ("3.24s") because that's the scale
 * where hardware people compare event spacing.
 */
export function formatDeltaMs(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 1) return "0ms";
  if (abs < 1000) return `${Math.round(abs)}ms`;
  if (abs < 60_000) {
    // Trim trailing zeros: 3.24s, 3.2s, 3s
    const s = (abs / 1000).toFixed(2).replace(/\.?0+$/, "");
    return `${s}s`;
  }
  if (abs < 3_600_000) {
    const m = Math.floor(abs / 60_000);
    const s = Math.round((abs % 60_000) / 1000);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  if (abs < 86_400_000) {
    const h = Math.floor(abs / 3_600_000);
    const m = Math.round((abs % 3_600_000) / 60_000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(abs / 86_400_000);
  const h = Math.round((abs % 86_400_000) / 3_600_000);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}
