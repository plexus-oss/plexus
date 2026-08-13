/**
 * POST /api/assistant/label — propose annotations for a chart window via a
 * LOCAL Ollama model (structured outputs). Read-only: the model only proposes;
 * the user applies each observation through the normal annotations API.
 *
 * Auth/access mirrors /api/telemetry/batch-query: dual auth, org scoping, and
 * filterAccessibleSlugs over the qualified "slug:metric" keys.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withDualAuth } from "@/lib/api/with-auth";
import { validateBody } from "@/lib/api/validate";
import { queryTelemetryAdaptive } from "@/lib/db/clickhouse";
import { filterAccessibleSlugs } from "@/lib/access/sources";
import { annotationQueries } from "@/lib/db/queries/misc";
import { ollamaChatJson, OllamaUnavailableError } from "@/lib/ai/label/ollama";
import {
  buildLabelPrompt,
  clampObservations,
  summarizeSeries,
  LABEL_RESPONSE_SCHEMA,
  LABEL_SYSTEM_PROMPT,
  type SeriesSummary,
  type WindowAnnotation,
} from "@/lib/ai/label/prompt";

const LabelRequestSchema = z.object({
  /** Qualified "slug:metric" keys, exactly as the chart queries them. */
  metrics: z
    .array(z.string().regex(/^[^:]+:.+$/, "metrics must be slug:metric"))
    .min(1)
    .max(10),
  start: z.number().int(),
  end: z.number().int(),
});

export const POST = withDualAuth(
  async (request, { orgId, userId, orgRole, isApiKeyAuth }) => {
    const body = await validateBody(request, LabelRequestSchema);
    if (body.end <= body.start) {
      return NextResponse.json({ error: "end must be after start" }, { status: 400 });
    }
    const startDate = new Date(body.start);
    const endDate = new Date(body.end);

    // Access filter — same pattern as batch-query: resolve which slugs the
    // caller may view and drop everything else before touching ClickHouse.
    const ctx = { orgId, userId, orgRole, isApiKeyAuth };
    const slugs = [...new Set(body.metrics.map((m) => m.slice(0, m.indexOf(":"))))];
    const accessible = await filterAccessibleSlugs(ctx, slugs);
    const metrics = body.metrics.filter((m) =>
      accessible.has(m.slice(0, m.indexOf(":"))),
    );
    if (metrics.length === 0) {
      return NextResponse.json({ error: "No accessible metrics" }, { status: 403 });
    }

    // Series data via the same server helper batch-query uses.
    const series: SeriesSummary[] = [];
    await Promise.all(
      metrics.map(async (m) => {
        const colon = m.indexOf(":");
        const result = await queryTelemetryAdaptive(
          orgId,
          m.slice(0, colon),
          m.slice(colon + 1),
          startDate,
          endDate,
          10000,
        );
        const summary = summarizeSeries(m, result.points, body.start, body.end);
        if (summary) series.push(summary);
      }),
    );
    if (series.length === 0) {
      return NextResponse.json({ observations: [], model: null });
    }

    // Existing annotations in the window, restricted to the plotted sources.
    const slugSet = new Set(metrics.map((m) => m.slice(0, m.indexOf(":"))));
    const annotations: WindowAnnotation[] = (
      await annotationQueries.findByTimeRange(orgId, startDate, endDate)
    )
      .filter((a) => !a.source_id || slugSet.has(a.source_id))
      .map((a) => ({
        label: a.label,
        startMs: new Date(a.timestamp_start).getTime(),
        endMs: a.timestamp_end ? new Date(a.timestamp_end).getTime() : null,
      }));

    const prompt = buildLabelPrompt({
      windowStartMs: body.start,
      windowEndMs: body.end,
      series,
      annotations,
    });

    let observations;
    let model: string;
    try {
      const reply = await ollamaChatJson<unknown>({
        system: LABEL_SYSTEM_PROMPT,
        user: prompt,
        schema: LABEL_RESPONSE_SCHEMA,
      });
      model = reply.model;
      observations = clampObservations(reply.result, body.start, body.end);
    } catch (err) {
      if (err instanceof OllamaUnavailableError) {
        return NextResponse.json(
          { error: "labeling_unavailable" },
          { status: 503 },
        );
      }
      throw err;
    }

    // Proposal log. system_events is the wrong shape here (strict platform
    // CRUD event-type unions feeding the org activity feed) and ai_usage only
    // counts tokens — so a structured server log it is.
    console.log(
      "[assistant-label] proposed",
      JSON.stringify({
        orgId,
        userId: userId ?? null,
        model,
        metrics,
        window: { start: body.start, end: body.end },
        count: observations.length,
      }),
    );

    return NextResponse.json({ observations, model });
  },
);
