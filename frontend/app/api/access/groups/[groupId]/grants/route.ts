import { NextResponse } from "next/server";
import { withRoleAuth } from "@/lib/api/with-auth";
import { validateBody } from "@/lib/api/validate";
import { AddGrantSchema } from "@/lib/validation/api-schemas";
import { groupGrantQueries, parseGroupId } from "@/lib/db/queries/access";
import { entitled, FEATURE_RBAC } from "@/lib/licensing";

/**
 * GET /api/access/groups/[groupId]/grants — list everything a group can access.
 * POST — grant a device / fleet / dashboard to the group. Admin only.
 *
 * `groupId` is a custom-role UUID, or a role keyword: viewer | editor | admin.
 */
export const GET = withRoleAuth(
  ["org:admin"],
  async (_request, { orgId, params }) => {
    const { groupId } = await params;
    const grants = await groupGrantQueries.list(orgId, parseGroupId(groupId));
    return NextResponse.json({ grants });
  },
);

export const POST = withRoleAuth(
  ["org:admin"],
  async (request, { orgId, userId, params }) => {
    // Fine-grained resource grants are enterprise (RBAC). Reads + removals
    // stay open so an expired key degrades to read-only, never a lockout.
    if (!entitled(FEATURE_RBAC)) {
      return NextResponse.json(
        {
          error: "Fine-grained access grants require an enterprise license",
          code: "license_required",
        },
        { status: 403 },
      );
    }
    const { groupId } = await params;
    const ref = parseGroupId(groupId);
    const body = await validateBody(request, AddGrantSchema);
    await groupGrantQueries.add(
      orgId,
      ref,
      body.kind,
      body.resourceId,
      body.accessLevel ?? "view",
      userId,
    );
    const grants = await groupGrantQueries.list(orgId, ref);
    return NextResponse.json({ grants }, { status: 201 });
  },
);
