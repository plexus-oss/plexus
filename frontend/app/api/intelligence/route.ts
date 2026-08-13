/**
 * GET /api/intelligence — the model-observability read for the /intelligence
 * page: 7-day stats over labeling runs, the recent runs themselves (each with
 * its retrieval record + verdicts), and the "Model memory" notes the model
 * asked to remember (retrieved into every future run on those sources).
 *
 * Auth mirrors the Events page: org-scoped session auth; scoped
 * (external/guest) users only see runs and memories whose sources are in
 * their allow-list — deny-by-default via the same choke points Events uses
 * (filterAccessibleSlugs / loadAllowedSourceIds).
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { aiLabelRunQueries, sourceContextQueries } from "@/lib/db";
import { sourceQueries } from "@/lib/db/queries/sources";
import {
  filterAccessibleSlugs,
  loadAllowedSourceIds,
} from "@/lib/access/sources";
import { computeLabelRunStats } from "@/lib/ai/label/run-stats";
import type { Source } from "@/lib/db/types";

/** Name the labeling flow saves model memories under (see label-proposals). */
const MODEL_MEMORY_NAME = "Model memory";

/** Enough history for 7-day stats; the table shows the newest 50. */
const RUN_FETCH_LIMIT = 500;
const RUN_TABLE_LIMIT = 50;

const slugOf = (metric: string): string => metric.slice(0, metric.indexOf(":"));

export const GET = withAuth(async (_request, { orgId, userId, orgRole, roleId }) => {
  const [allRuns, memoryRows] = await Promise.all([
    aiLabelRunQueries.findRecent(orgId, RUN_FETCH_LIMIT),
    sourceContextQueries.findNotesByName(orgId, MODEL_MEMORY_NAME),
  ]);

  // Scope runs like Events scopes events: a run is visible only when every
  // source it touched is visible to the caller (deny-by-default for scoped
  // users; full-access users pass everything through).
  const ctx = { orgId, userId, orgRole, roleId, isApiKeyAuth: false };
  const allSlugs = [
    ...new Set(
      allRuns.flatMap((r) => (r.metrics ?? []).map(slugOf)).filter(Boolean),
    ),
  ];
  const accessible = await filterAccessibleSlugs(ctx, allSlugs);
  const runs = allRuns.filter((r) =>
    (r.metrics ?? []).every((m) => accessible.has(slugOf(m))),
  );

  // Model memories: same allow-list rule Events applies to source-bound rows.
  const allowed = await loadAllowedSourceIds(orgId, userId);
  const memories = allowed
    ? memoryRows.filter((m) => allowed.has(m.source_id))
    : memoryRows;

  // slug → display info for the runs table + context links.
  const visibleSlugs = [
    ...new Set(runs.flatMap((r) => (r.metrics ?? []).map(slugOf))),
  ];
  const sourceRows =
    visibleSlugs.length > 0
      ? ((await sourceQueries.findBySlugs(orgId, visibleSlugs)) as Source[])
      : [];
  const sources: Record<string, { name: string | null; type: string }> = {};
  for (const s of sourceRows) {
    sources[s.slug] = { name: s.name, type: s.source_type };
  }

  return NextResponse.json({
    stats: computeLabelRunStats(runs),
    runs: runs.slice(0, RUN_TABLE_LIMIT).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      provider: r.provider,
      model: r.model,
      latency_ms: r.latency_ms,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      metrics: r.metrics ?? [],
      window_start: r.window_start,
      window_end: r.window_end,
      context_items: r.context_items ?? [],
      observations: r.observations ?? [],
    })),
    sources,
    memory: memories.map((m) => ({
      id: m.id,
      source_id: m.source_id,
      source_slug: m.source_slug,
      source_name: m.source_name,
      source_type: m.source_type,
      content: m.content,
      created_at: m.created_at,
    })),
  });
});
