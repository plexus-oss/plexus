"use client";

/**
 * Client-side telemetry request batcher.
 *
 * Collects individual telemetry requests within a 50ms window,
 * merges them into a single POST /api/telemetry/batch-query,
 * and distributes results back to callers via Promise resolution.
 */

import { createContext } from "react";

type PointRow = {
  timestamp: string;
  value: number;
  /** Per-bucket raw-event totals for downsampled points (see TelemetryPoint). */
  sum?: number;
  count?: number;
  source_id?: string | null;
};
type QueryResult = Record<string, PointRow[]>;

interface PendingQuery {
  id: string;
  metrics: string[];
  timeRange: string;
  sourceId?: string;
  resolve: (data: QueryResult) => void;
  reject: (error: Error) => void;
}

export interface TelemetryBatcher {
  fetch: (
    metrics: string[],
    timeRange: string,
    sourceId?: string,
  ) => Promise<QueryResult>;
}

export function createTelemetryBatcher(): TelemetryBatcher {
  const pending: PendingQuery[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idCounter = 0;

  async function flush() {
    timer = null;
    const batch = pending.splice(0);
    if (batch.length === 0) return;

    try {
      const res = await fetch("/api/telemetry/batch-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: batch.map((q) => ({
            id: q.id,
            metrics: q.metrics,
            timeRange: q.timeRange,
            sourceId: q.sourceId,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const error = new Error(err.message || "Batch query failed");
        for (const q of batch) q.reject(error);
        return;
      }

      const { results } = await res.json();

      for (const q of batch) {
        q.resolve(results[q.id]?.data || {});
      }
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("Batch query failed");
      for (const q of batch) q.reject(error);
    }
  }

  return {
    fetch(metrics, timeRange, sourceId) {
      return new Promise((resolve, reject) => {
        pending.push({
          id: `q${idCounter++}`,
          metrics,
          timeRange,
          sourceId,
          resolve,
          reject,
        });

        if (!timer) {
          timer = setTimeout(() => flush(), 50);
        }
      });
    },
  };
}

// Context for sharing a batcher across dashboard panels
export const TelemetryBatchContext = createContext<TelemetryBatcher | null>(
  null,
);

