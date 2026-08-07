/**
 * Reconcile sources.last_seen_at from ClickHouse.
 *
 * Telemetry lands in ClickHouse (device → gateway → Redis → loader → ClickHouse)
 * and never touches the Postgres `sources` table, so `last_seen_at` was never
 * written in production. Two things broke as a result:
 *   1. the offline / "stream stopped" detector (detect-offline.ts keys entirely
 *      off last_seen_at) could never fire — a NULL last_seen_at is treated as
 *      "never seen" and skipped;
 *   2. every UI status endpoint derives online/offline from last_seen_at, so
 *      live devices showed as "unknown"/"offline".
 *
 * This pulls the real last-data time per source from ClickHouse and writes it
 * back to Postgres each offline-loop tick, just before the offline scan runs —
 * so the detector and the UI both read an accurate value. ClickHouse source_id
 * is the device slug; `sources` is keyed by (org_id, slug).
 */

import "server-only";

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sources } from "@/lib/db/schema";
import { getLatestDataPerSource } from "@/lib/db/clickhouse";

// Matches the window the UI status endpoints use to call a device online.
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

interface SourceRow {
  id: string;
  org_id: string;
  slug: string;
  last_seen_at: string | null;
  status: string | null;
}

export interface ReconcileResult {
  updated: number;
}

export async function reconcileLastSeen(
  lookbackDays = 7,
): Promise<ReconcileResult> {
  const latest = await getLatestDataPerSource(lookbackDays);
  if (latest.length === 0) return { updated: 0 };

  // One read to diff against, so we only write rows that actually changed
  // (the loop runs every 30s — no point rewriting a frozen value each tick).
  const orgIds = [...new Set(latest.map((r) => r.org_id))];
  const sourceRows = (await db
    .select({
      id: sources.id,
      org_id: sources.org_id,
      slug: sources.slug,
      last_seen_at: sources.last_seen_at,
      status: sources.status,
    })
    .from(sources)
    .where(inArray(sources.org_id, orgIds))) as unknown as SourceRow[];

  const byKey = new Map(sourceRows.map((s) => [`${s.org_id}::${s.slug}`, s]));

  const now = Date.now();
  let updated = 0;

  for (const row of latest) {
    // CH may have data for a slug with no Postgres source row (e.g. deleted) —
    // nothing to update.
    const src = byKey.get(`${row.org_id}::${row.source_id}`);
    if (!src) continue;

    const lastSeenMs = Date.parse(row.last_data_at);
    const status = now - lastSeenMs < ONLINE_THRESHOLD_MS ? "online" : "offline";

    // Compare by epoch (Postgres and our ISO string serialize differently) so
    // an unchanged source is a no-op.
    const currentMs = src.last_seen_at ? Date.parse(src.last_seen_at) : null;
    if (currentMs === lastSeenMs && src.status === status) continue;

    try {
      await db
        .update(sources)
        .set({ last_seen_at: row.last_data_at, status } as Partial<
          typeof sources.$inferInsert
        >)
        .where(eq(sources.id, src.id));
    } catch (upErr) {
      console.error("[reconcile-last-seen] update failed:", src.id, upErr);
      continue;
    }
    updated++;
  }

  return { updated };
}
