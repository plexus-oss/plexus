/**
 * Single source of truth for device online/offline derivation.
 *
 * Every surface that shows a status (home tiles, fleet list, device page,
 * Live tab, API responses) must derive it from here — the app previously
 * had five copies of this logic that could disagree on one screen.
 */

export const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
// Discovered devices are fed by the discovery poll loop, not a live stream —
// give them a full hour before flipping offline.
export const DISCOVERED_ONLINE_THRESHOLD_MS = 60 * 60 * 1000;

type StatusSource = {
  source_type: string;
  last_seen_at: string | null;
  device_type?: string | null;
  metadata?: unknown;
};

/**
 * Derive a device source's status from its row. Returns the row's existing
 * status untouched for non-device sources (connections manage their own).
 */
export function deriveDeviceStatus<T extends StatusSource>(
  source: T,
  now: number = Date.now(),
): "online" | "offline" | null {
  if (source.source_type !== "device") return null;
  // Satellites don't stream telemetry — always "online"
  if (source.device_type === "satellite") return "online";
  const lastSeenMs = source.last_seen_at
    ? new Date(source.last_seen_at).getTime()
    : NaN;
  const metadata =
    source.metadata &&
    typeof source.metadata === "object" &&
    !Array.isArray(source.metadata)
      ? (source.metadata as Record<string, unknown>)
      : null;
  // Auto-discovered devices (rows sliced out of a connection table):
  // online iff the discovery loop has seen them within the last hour.
  const threshold = metadata?.discovered_from
    ? DISCOVERED_ONLINE_THRESHOLD_MS
    : ONLINE_THRESHOLD_MS;
  return Number.isFinite(lastSeenMs) && now - lastSeenMs < threshold
    ? "online"
    : "offline";
}

/**
 * Enrich device sources with computed online/offline status
 * based on last_seen_at timestamp.
 */
export function enrichDeviceStatus<T extends StatusSource>(sources: T[]): T[] {
  const now = Date.now();
  return sources.map((source) => {
    const status = deriveDeviceStatus(source, now);
    return status ? { ...source, status } : source;
  });
}
