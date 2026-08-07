/**
 * Plexus Telemetry Connection Schema API
 *
 * GET /api/telemetry/connection/schema - Get the telemetry table schema
 *
 * Returns the same shape as external connection schema endpoints
 * so it works with the existing table/column picker UI.
 */

import { NextResponse } from "next/server";
import { withOrgAuth } from "@/lib/api/with-auth";
import { getClient } from "@/lib/db/clickhouse";

export const GET = withOrgAuth(async () => {
  const client = getClient();

  try {
    const result = await client.query({
      query: "DESCRIBE TABLE telemetry",
      format: "JSONEachRow",
    });

    const describeRows = (await result.json()) as Array<{
      name: string;
      type: string;
      default_type: string;
      default_expression: string;
    }>;

    // Filter out internal columns users don't need to see
    const internalColumns = new Set(["org_id", "_inserted_at"]);
    const columns = describeRows
      .filter((row) => !internalColumns.has(row.name))
      .map((row) => ({
        name: row.name,
        type: row.type,
        nullable: row.type.startsWith("Nullable"),
      }));

    return NextResponse.json({
      schema: {
        tables: [
          {
            name: "telemetry",
            columns,
          },
        ],
      },
    });
  } finally {
    await client.close();
  }
});
