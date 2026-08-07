import { NextResponse } from "next/server";
import { withDualAuth, requirePermission } from "@/lib/api/with-auth";
import { annotationQueries } from "@/lib/db/queries/misc";
import { UpdateAnnotationSchema } from "@/lib/validation/api-schemas";

/**
 * PATCH /api/annotations/:id - Update an annotation
 */
export const PATCH = withDualAuth(
  async (request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
    if (!isApiKeyAuth) {
      await requirePermission(
        { orgId, orgRole, userId },
        "action-edit-annotation",
      );
    }
    const { id } = await params;
    const body = await request.json();
    const parsed = UpdateAnnotationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 },
      );
    }

    const results = await annotationQueries.update(orgId, id, parsed.data);
    return NextResponse.json({ annotation: results[0] });
  },
);

/**
 * DELETE /api/annotations/:id - Delete an annotation
 */
export const DELETE = withDualAuth(
  async (_request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
    if (!isApiKeyAuth) {
      await requirePermission(
        { orgId, orgRole, userId },
        "action-delete-annotation",
      );
    }
    const { id } = await params;
    await annotationQueries.delete(orgId, id);
    return NextResponse.json({ success: true });
  },
);
