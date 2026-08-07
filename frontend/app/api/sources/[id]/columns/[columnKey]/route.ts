/**
 * Single-column metadata API.
 *
 * PATCH  /api/sources/[id]/columns/[columnKey]  → upsert one column's annotations
 * DELETE /api/sources/[id]/columns/[columnKey]  → clear annotations for one column
 *
 * columnKey is URL-encoded by the client because connection keys contain dots
 * (e.g. "public.users.email"). Next.js decodes the route param for us.
 */

import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { validateBody } from "@/lib/api/validate";
import { findSourceByIdOrSlug } from "@/lib/api/find-source";
import { columnMetadataQueries } from "@/lib/db";
import { enforceSource } from "@/lib/access/sources";
import { UpsertColumnMetadataSchema } from "@/lib/validation/api-schemas";

export const PATCH = withDualAuth(
  async (request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
  const { id, columnKey } = await params;
  const source = await findSourceByIdOrSlug(orgId, id);
  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  await enforceSource({ orgId, userId, orgRole, isApiKeyAuth }, source, "edit");

  const patch = await validateBody(request, UpsertColumnMetadataSchema);
  const column = await columnMetadataQueries.upsert(
    orgId,
    source.slug,
    columnKey,
    patch
  );

  return NextResponse.json({ column });
});

export const DELETE = withDualAuth(
  async (_request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
  const { id, columnKey } = await params;
  const source = await findSourceByIdOrSlug(orgId, id);
  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  await enforceSource({ orgId, userId, orgRole, isApiKeyAuth }, source, "edit");

  await columnMetadataQueries.remove(orgId, source.slug, columnKey);
  return new NextResponse(null, { status: 204 });
});
