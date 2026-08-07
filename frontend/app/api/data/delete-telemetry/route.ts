import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { validateBody } from "@/lib/api/validate";
import { DeleteDataSchema } from "@/lib/validation/api-schemas";
import { deleteTelemetryByFilter } from "@/lib/db/clickhouse";
import { apiError } from "@/lib/api/errors";

export const POST = withDualAuth(
  async (request, { orgId, orgRole, isApiKeyAuth }) => {
    // Destructive, org-wide, irreversible: session callers must be admins.
    // API-key callers are gated by the "write" scope below.
    if (!isApiKeyAuth && orgRole !== "org:admin") {
      throw apiError("FORBIDDEN", "Only org admins can delete telemetry");
    }

    const body = await validateBody(request, DeleteDataSchema);

    await deleteTelemetryByFilter(orgId, body.sourceIds, {
      startTime: body.startTime ? new Date(body.startTime) : undefined,
      endTime: body.endTime ? new Date(body.endTime) : undefined,
    });

    return NextResponse.json({ deleted: true });
  },
  { requiredScope: "write" },
);
