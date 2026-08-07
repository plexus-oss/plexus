/**
 * Auto-Threshold Suggestions — Purely statistical, no LLM needed.
 *
 * Queries ClickHouse for per-metric statistics (p95, p99, mean, stddev)
 * over the last 24 hours. Skips metrics with fewer than 100 data points
 * or that already have limits configured.
 *
 * suggestedMax = Math.ceil(p99 * 1.1)  (10% headroom above p99)
 * suggestedMin = Math.floor(mean - 3 * stddev), clamped to 0
 */

import { getClient } from "@/lib/db/clickhouse";

export interface ThresholdSuggestion {
  metric: string;
  p95: number;
  p99: number;
  mean: number;
  suggestedMax: number;
  suggestedMin?: number;
  severity: "warning" | "critical";
  explanation: string;
}

export async function suggestThresholds(context: {
  orgId: string;
  sourceId: string;
  existingLimits: Record<string, { min?: number; max?: number }>;
}): Promise<ThresholdSuggestion[]> {
  const client = getClient();

  try {
    const result = await client.query({
      query: `
        SELECT
          metric,
          quantileExact(0.95)(value) AS p95,
          quantileExact(0.99)(value) AS p99,
          avg(value) AS mean,
          stddevPop(value) AS stddev,
          count() AS cnt
        FROM telemetry
        WHERE org_id = {orgId:String}
          AND source_id = {sourceId:String}
          AND timestamp > now() - INTERVAL 24 HOUR
          AND value IS NOT NULL
        GROUP BY metric
        HAVING cnt >= 100
      `,
      query_params: {
        orgId: context.orgId,
        sourceId: context.sourceId,
      },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      metric: string;
      p95: string;
      p99: string;
      mean: string;
      stddev: string;
      cnt: string;
    }>;

    const suggestions: ThresholdSuggestion[] = [];

    for (const row of rows) {
      const metric = row.metric;

      // Skip metrics that already have limits
      if (context.existingLimits[metric]) {
        continue;
      }

      const p95 = parseFloat(row.p95);
      const p99 = parseFloat(row.p99);
      const mean = parseFloat(row.mean);
      const stddev = parseFloat(row.stddev);
      const count = parseInt(row.cnt);

      // Skip if stats are NaN
      if (isNaN(p95) || isNaN(p99) || isNaN(mean)) {
        continue;
      }

      const suggestedMax = Math.ceil(p99 * 1.1);

      let suggestedMin: number | undefined;
      if (mean > 0 && !isNaN(stddev)) {
        const rawMin = Math.floor(mean - 3 * stddev);
        suggestedMin = Math.max(0, rawMin);
      }

      const explanation =
        `Based on ${count} data points over the last 24h: ` +
        `mean=${mean.toFixed(2)}, p95=${p95.toFixed(2)}, p99=${p99.toFixed(2)}. ` +
        `Suggested max is 10% above p99.`;

      suggestions.push({
        metric,
        p95,
        p99,
        mean,
        suggestedMax,
        suggestedMin,
        severity: "warning",
        explanation,
      });
    }

    return suggestions;
  } catch (error) {
    console.error("[ThresholdSuggestions] Error:", error);
    return [];
  } finally {
    await client.close();
  }
}
