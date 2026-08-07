/**
 * Column Metadata API — per-column annotations used for better AI/ML inference.
 *
 * GET  /api/sources/[id]/columns  → list all column annotations for a source
 * PUT  /api/sources/[id]/columns  → bulk upsert (used by "accept all AI suggestions")
 */

import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { validateBody } from "@/lib/api/validate";
import { findSourceByIdOrSlug } from "@/lib/api/find-source";
import { columnMetadataQueries } from "@/lib/db";
import { enforceSource } from "@/lib/access/sources";
import { BulkUpsertColumnMetadataSchema } from "@/lib/validation/api-schemas";

export const GET = withDualAuth(
  async (_request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
  const { id } = await params;
  const source = await findSourceByIdOrSlug(orgId, id);
  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  await enforceSource({ orgId, userId, orgRole, isApiKeyAuth }, source, "view");

  const columns = await columnMetadataQueries.findBySource(orgId, source.slug);
  return NextResponse.json({ columns });
});

export const PUT = withDualAuth(
  async (request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
  const { id } = await params;
  const source = await findSourceByIdOrSlug(orgId, id);
  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  await enforceSource({ orgId, userId, orgRole, isApiKeyAuth }, source, "edit");

  const body = await validateBody(request, BulkUpsertColumnMetadataSchema);

  const saved = [];
  for (const { column_key, ...patch } of body.columns) {
    saved.push(
      await columnMetadataQueries.upsert(orgId, source.slug, column_key, patch)
    );
  }

  return NextResponse.json({ columns: saved });
});
