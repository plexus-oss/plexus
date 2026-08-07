/** Compact duration label shared by annotation surfaces (matches alert-bands). */
export function formatRelDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 1000) return `${Math.round(abs)}ms`;
  if (abs < 60_000) return `${(abs / 1000).toFixed(1)}s`;
  if (abs < 3_600_000) return `${(abs / 60_000).toFixed(1)}m`;
  if (abs < 86_400_000) return `${(abs / 3_600_000).toFixed(1)}h`;
  return `${(abs / 86_400_000).toFixed(1)}d`;
}
