/**
 * Runs API
 *
 * GET  /api/runs   — list test runs for the org (?source_id=&status=)
 * POST /api/runs   — create a run (UI "Save as run", or test scripts via API key)
 *
 * A run is a named time window on a source: started_at → ended_at. Test
 * scripts open one before a hot-fire (status "active") and PATCH it closed;
 * the dashboard Compare picker and /runs recall them afterward.
 */

import { NextResponse } from "next/server";
import { withDualAuth, requirePermission } from "@/lib/api/with-auth";
import { apiError, errorResponse } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { loadAllowedSourceIds } from "@/lib/access/sources";
import { runQueries, type RunStatus } from "@/lib/db/queries/runs";
import { findSourceByRef } from "@/lib/api/find-source";
import { CreateRunSchema } from "@/lib/validation/api-schemas";

const VALID_STATUSES: RunStatus[] = ["active", "completed", "aborted"];

export const GET = withDualAuth(async (req, { orgId, userId }) => {
  try {
    const url = new URL(req.url);
    const sourceRef = url.searchParams.get("source_id");
    const status = url.searchParams.get("status");

    if (status && !VALID_STATUSES.includes(status as RunStatus)) {
      throw apiError("VALIDATION_ERROR", "status must be active|completed|aborted");
    }

    let sourceId: string | undefined;
    if (sourceRef) {
      const source = await findSourceByRef(orgId, sourceRef, true);
      if (!source) throw apiError("NOT_FOUND", "Device not found");
      sourceId = source.id;
    }

    let runs = await runQueries.findByOrg(orgId, {
      sourceId,
      status: (status as RunStatus) || undefined,
    });

    // Scoped members only see runs for their allow-listed sources
    // (sourceless runs are hidden from them). API keys are org-scoped.
    const allowed = userId ? await loadAllowedSourceIds(orgId, userId) : null;
    if (allowed) {
      runs = runs.filter((r) => !!r.source_id && allowed.has(r.source_id));
    }

    return NextResponse.json({ runs });
  } catch (err) {
    return errorResponse(err);
  }
});

export const POST = withDualAuth(
  async (req, { orgId, userId, orgRole, roleId, isApiKeyAuth }) => {
    try {
      if (!isApiKeyAuth) {
        await requirePermission(
          { orgId, orgRole, userId, roleId },
          "action-create-run",
        );
      }
      const body = await validateBody(req, CreateRunSchema);

      let sourceId: string | null = null;
      if (body.source_id) {
        const source = await findSourceByRef(orgId, body.source_id, isApiKeyAuth);
        if (!source) throw apiError("NOT_FOUND", "Device not found");
        const allowed = userId
          ? await loadAllowedSourceIds(orgId, userId)
          : null;
        if (allowed && !allowed.has(source.id)) {
          throw apiError("NOT_FOUND", "Device not found");
        }
        sourceId = source.id;
      }

      if (body.ended_at && body.started_at && body.ended_at < body.started_at) {
        throw apiError("VALIDATION_ERROR", "ended_at must be after started_at");
      }

      const run = await runQueries.insert({
        org_id: orgId,
        name: body.name,
        source_id: sourceId,
        status: body.status,
        started_at: body.started_at,
        ended_at: body.ended_at ?? null,
        tags: body.tags,
        metadata: body.metadata,
        pass_criteria: body.pass_criteria,
        created_by: userId ?? null,
      });

      return NextResponse.json({ run }, { status: 201 });
    } catch (err) {
      return errorResponse(err);
    }
  },
);
