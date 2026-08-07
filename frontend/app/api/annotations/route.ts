import { NextResponse } from "next/server";
import { withDualAuth, requirePermission } from "@/lib/api/with-auth";
import { annotationQueries } from "@/lib/db/queries/misc";
import { CreateAnnotationSchema } from "@/lib/validation/api-schemas";

/**
 * GET /api/annotations - List annotations with filters
 * Query params: sourceId, start, end
 */
export const GET = withDualAuth(async (request, { orgId }) => {
  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get("sourceId");
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  let annotations;

  if (sourceId && start && end) {
    annotations = await annotationQueries.findBySourceInRange(
      orgId,
      sourceId,
      new Date(start),
      new Date(end),
    );
  } else if (start && end) {
    annotations = await annotationQueries.findByTimeRange(
      orgId,
      new Date(start),
      new Date(end),
      sourceId || undefined,
    );
  } else {
    annotations = await annotationQueries.findAll(orgId);
  }

  return NextResponse.json({ annotations });
});

/**
 * POST /api/annotations - Create an annotation
 */
export const POST = withDualAuth(async (request, { orgId, userId, orgRole, isApiKeyAuth }) => {
  if (!isApiKeyAuth) {
    await requirePermission({ orgId, orgRole, userId }, "action-create-annotation");
  }
  const body = await request.json();
  const parsed = CreateAnnotationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 },
    );
  }

  const results = await annotationQueries.insert(orgId, {
    source_type: "device",
    source_id: parsed.data.source_id,
    timestamp_start: parsed.data.timestamp_start,
    timestamp_end: parsed.data.timestamp_end || null,
    label: parsed.data.label,
    color: parsed.data.color,
    notes: parsed.data.notes || null,
    metric_name: parsed.data.metric_name || null,
    run_id: parsed.data.run_id || null,
    created_by: userId || null,
  });
  const annotation = results[0];

  return NextResponse.json({ annotation }, { status: 201 });
});
