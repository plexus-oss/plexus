import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { Alert, AlertStats, LiveStats } from "@/lib/db/types";

const POLL_INTERVAL = 5_000;

export type AlertStatsResult =
  | { kind: "live"; data: LiveStats }
  | { kind: "closed"; data: AlertStats }
  | { kind: "none" };

export function useAlertStats(
  alert: Alert,
  sourceSlug: string | null | undefined,
): AlertStatsResult {
  const isLive = alert.is_alert_active;
  const canPoll = isLive && !!alert.rule_id && !!sourceSlug;

  const url = canPoll
    ? `/api/alerts/live-stats?rule=${alert.rule_id}&source=${encodeURIComponent(sourceSlug!)}`
    : null;

  const { data } = useSWR<LiveStats>(url, fetcher, {
    refreshInterval: POLL_INTERVAL,
    // 404 = alert just closed; suppress error, fall through to closed stats
    onErrorRetry: (err, _key, _cfg, revalidate, { retryCount }) => {
      if (err?.status === 404) return;
      if (retryCount >= 3) return;
      setTimeout(() => revalidate({ retryCount }), 5_000);
    },
  });

  if (isLive && data) {
    return { kind: "live", data };
  }

  const closed = alert.alert_stats as AlertStats | null;
  if (!isLive && closed?.duration_seconds != null) {
    return { kind: "closed", data: closed };
  }

  return { kind: "none" };
}
