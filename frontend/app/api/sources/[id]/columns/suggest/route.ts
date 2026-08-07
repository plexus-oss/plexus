/**
 * AI column-metadata suggestion.
 *
 * POST /api/sources/[id]/columns/suggest
 *   body:  { columns: [{ column_key, inferred_type, sample_values?, min?, max? }] }
 *   reply: { suggestions: ColumnSuggestion[] }
 *
 * Does NOT persist — the client shows the suggestions and the user accepts them
 * via the normal PATCH/PUT routes (which set source_origin "ai_accepted").
 */

import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { validateBody } from "@/lib/api/validate";
import { findSourceByIdOrSlug } from "@/lib/api/find-source";
import { deviceSchemaQueries } from "@/lib/db";
import { suggestColumnMetadata } from "@/lib/ai/column-annotator";
import { enforceSource } from "@/lib/access/sources";
import { SuggestColumnsSchema } from "@/lib/validation/api-schemas";

export const POST = withDualAuth(
  async (request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
  const { id } = await params;
  const source = await findSourceByIdOrSlug(orgId, id);
  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  await enforceSource({ orgId, userId, orgRole, isApiKeyAuth }, source, "view");

  const body = await validateBody(request, SuggestColumnsSchema);

  // For devices, enrich missing min/max from the discovered schema so the model
  // sees value ranges even when the client didn't send them.
  let columns = body.columns;
  if (source.source_type === "device") {
    const schemas = await deviceSchemaQueries.findBySource(orgId, source.slug);
    const ranges = new Map(
      schemas.map((s) => [s.metric, { min: s.min_value, max: s.max_value }])
    );
    columns = columns.map((c) => {
      if (c.min != null || c.max != null) return c;
      const r = ranges.get(c.column_key);
      return r ? { ...c, min: r.min, max: r.max } : c;
    });
  }

  const suggestions = await suggestColumnMetadata(
    {
      slug: source.slug,
      name: source.name,
      deviceType: source.device_type,
    },
    columns,
    orgId
  );

  if (suggestions === null) {
    return NextResponse.json(
      { error: "Suggestion failed. Check ANTHROPIC_API_KEY." },
      { status: 500 }
    );
  }

  return NextResponse.json({ suggestions });
});
