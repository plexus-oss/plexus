/**
 * Single-run API
 *
 * GET    /api/runs/[id]   — fetch one run
 * PATCH  /api/runs/[id]   — update (close a run by setting ended_at + status)
 * DELETE /api/runs/[id]   — delete
 */

import { NextResponse } from "next/server";
import { withDualAuth, requirePermission } from "@/lib/api/with-auth";
import { apiError, errorResponse } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { loadAllowedSourceIds } from "@/lib/access/sources";
import { runQueries } from "@/lib/db/queries/runs";
import { UpdateRunSchema } from "@/lib/validation/api-schemas";

export const GET = withDualAuth(async (_req, { orgId, userId, params }) => {
  try {
    const { id } = await params;
    const run = await runQueries.findById(orgId, id);
    if (!run) throw apiError("NOT_FOUND", "Run not found");
    const allowed = userId ? await loadAllowedSourceIds(orgId, userId) : null;
    if (allowed && (!run.source_id || !allowed.has(run.source_id))) {
      throw apiError("NOT_FOUND", "Run not found");
    }
    return NextResponse.json({ run });
  } catch (err) {
    return errorResponse(err);
  }
});

export const PATCH = withDualAuth(
  async (req, { orgId, userId, orgRole, roleId, isApiKeyAuth, params }) => {
    try {
      const { id } = await params;
      if (!isApiKeyAuth) {
        await requirePermission(
          { orgId, orgRole, userId, roleId },
          "action-edit-run",
        );
      }
      const body = await validateBody(req, UpdateRunSchema);

      const existing = await runQueries.findById(orgId, id);
      if (!existing) throw apiError("NOT_FOUND", "Run not found");

      const startedAt = body.started_at ?? existing.started_at;
      const endedAt = body.ended_at !== undefined ? body.ended_at : existing.ended_at;
      if (endedAt && endedAt < startedAt) {
        throw apiError("VALIDATION_ERROR", "ended_at must be after started_at");
      }

      // Closing a run without an explicit status marks it completed.
      const status =
        body.status ??
        (body.ended_at && existing.status === "active" ? "completed" : undefined);

      const run = await runQueries.update(orgId, id, {
        ...body,
        ...(status ? { status } : {}),
      });
      return NextResponse.json({ run });
    } catch (err) {
      return errorResponse(err);
    }
  },
);

export const DELETE = withDualAuth(
  async (_req, { orgId, userId, orgRole, roleId, isApiKeyAuth, params }) => {
    try {
      const { id } = await params;
      if (!isApiKeyAuth) {
        await requirePermission(
          { orgId, orgRole, userId, roleId },
          "action-delete-run",
        );
      }
      const deleted = await runQueries.delete(orgId, id);
      if (!deleted) throw apiError("NOT_FOUND", "Run not found");
      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return errorResponse(err);
    }
  },
);
