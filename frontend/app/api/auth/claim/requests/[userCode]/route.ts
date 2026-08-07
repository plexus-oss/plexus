import { NextResponse } from "next/server";
import { withRoleAuth } from "@/lib/api/with-auth";
import {
  adminDeviceAuthQueries,
  isClaimExpired,
} from "@/lib/db/queries/device-auth";

/**
 * Approval side of the coding-agent key-claim flow. Keyed by the short
 * human-facing user_code (never the device_code — that stays with the
 * agent). Session-only, admin/editor — mirrors manual key minting.
 */

/**
 * GET /api/auth/claim/requests/[userCode] - Inspect a claim for the approve page
 */
export const GET = withRoleAuth(
  ["org:admin", "org:editor"],
  async (_request, { params }) => {
    const { userCode } = await params;
    const row = await adminDeviceAuthQueries.findByUserCode(userCode);

    if (!row) {
      return NextResponse.json(
        { error: "Unknown claim request" },
        { status: 404 },
      );
    }

    const status =
      row.status === "pending" && isClaimExpired(row) ? "expired" : row.status;

    return NextResponse.json({
      requestedName: row.requested_name,
      status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    });
  },
);

/**
 * POST /api/auth/claim/requests/[userCode] - Approve or deny a claim
 *
 * Body: { approve: boolean }
 *
 * Approval stamps the approver's active org on the request; the key itself
 * is minted later, by the agent's next poll (see ../[deviceCode]/route.ts).
 */
export const POST = withRoleAuth(
  ["org:admin", "org:editor"],
  async (request, { orgId, params }) => {
    const { userCode } = await params;

    let approve: boolean | undefined;
    try {
      const body = (await request.json()) as { approve?: unknown };
      if (typeof body?.approve === "boolean") approve = body.approve;
    } catch {
      // fall through to validation error
    }
    if (approve === undefined) {
      return NextResponse.json(
        { error: "Body must be { approve: boolean }" },
        { status: 400 },
      );
    }

    const row = approve
      ? await adminDeviceAuthQueries.approve(userCode, orgId)
      : await adminDeviceAuthQueries.deny(userCode);

    if (!row) {
      // Already decided, expired, or never existed — the conditional
      // update matched nothing.
      return NextResponse.json(
        { error: "This request is no longer pending." },
        { status: 410 },
      );
    }

    return NextResponse.json({ status: row.status });
  },
);
