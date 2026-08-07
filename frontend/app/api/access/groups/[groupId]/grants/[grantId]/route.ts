import { NextResponse } from "next/server";
import { withRoleAuth } from "@/lib/api/with-auth";
import { validateBody } from "@/lib/api/validate";
import { UpdateGrantSchema } from "@/lib/validation/api-schemas";
import { apiError } from "@/lib/api/errors";
import { groupGrantQueries, type GrantKind } from "@/lib/db/queries/access";

/**
 * PATCH /api/access/groups/[groupId]/grants/[grantId] — change a grant's level.
 * DELETE ?kind=device|fleet|dashboard — remove a grant. Admin only.
 *
 * `kind` selects the backing table (source_permissions vs dashboard_permissions);
 * grants are addressed by their own id, so the group is implicit.
 */
export const PATCH = withRoleAuth(
  ["org:admin"],
  async (request, { orgId, params }) => {
    const { grantId } = await params;
    const body = await validateBody(request, UpdateGrantSchema);
    await groupGrantQueries.update(orgId, body.kind, grantId, body.accessLevel);
    return NextResponse.json({ success: true });
  },
);

export const DELETE = withRoleAuth(
  ["org:admin"],
  async (request, { orgId, params }) => {
    const { grantId } = await params;
    const kind = new URL(request.url).searchParams.get(
      "kind",
    ) as GrantKind | null;
    if (!kind || !["device", "fleet", "dashboard"].includes(kind)) {
      throw apiError("VALIDATION_ERROR", "kind query param is required");
    }
    await groupGrantQueries.remove(orgId, kind, grantId);
    return NextResponse.json({ success: true });
  },
);
