/**
 * Source Metrics API - Get available metrics for a source
 *
 * GET /api/sources/[id]/metrics - Get available metrics/columns for a source
 *
 * For devices: Returns distinct metrics from telemetry data
 * For connections: Returns columns from database schema
 * For recordings/imports: Returns distinct metrics from stored data
 */

import { NextResponse } from "next/server";
import { withOrgAuth } from "@/lib/api/with-auth";
import { findSourceByIdOrSlug } from "@/lib/api/find-source";
import { deviceSchemaQueries } from "@/lib/db";
import { enforceSource } from "@/lib/access/sources";
import { decrypt } from "@/lib/encryption";
import { getSchema } from "@/lib/db/data-source-connections";
import { singleflight } from "@/lib/db/query-cache";
import type { DataSourceType } from "@/lib/db/types";

export interface MetricInfo {
  name: string;
  type?: string;
  table?: string;
}

// GET /api/sources/[id]/metrics
export const GET = withOrgAuth(
  async (_request, { orgId, userId, orgRole, params }) => {
    const { id } = await params;

    // Find the source
    const source = await findSourceByIdOrSlug(orgId, id);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    await enforceSource(
      { orgId, userId: userId ?? undefined, orgRole, isApiKeyAuth: false },
      source,
      "view",
    );
    let metrics: MetricInfo[] = [];

    switch (source.source_type) {
      case "connection": {
        // Get columns from external database schema
        if (source.status !== "online") {
          return NextResponse.json(
            {
              error:
                "Source must be connected to get metrics. Test connection first.",
            },
            { status: 400 },
          );
        }

        if (!source.credentials_encrypted || !source.connection_type) {
          return NextResponse.json(
            { error: "Source is missing connection credentials" },
            { status: 400 },
          );
        }

        try {
          const credentialsEncrypted = source.credentials_encrypted;
          const existingConfig = (source.config as Record<string, unknown>) ?? {};
          const schema = await singleflight(`schema:${id}`, async () => {
            const connectionString = decrypt(credentialsEncrypted);
            return getSchema({
              type: source.connection_type as DataSourceType,
              connectionString,
              existingConfig,
            });
          });

          // Flatten schema tables/columns into metrics
          for (const table of schema.tables || []) {
            for (const column of table.columns || []) {
              metrics.push({
                name: column.name,
                type: column.type,
                table: table.name,
              });
            }
          }
        } catch (schemaError) {
          console.error("Error getting schema for metrics:", schemaError);
          return NextResponse.json(
            { error: "Failed to get schema from connection" },
            { status: 500 },
          );
        }
        break;
      }

      default: {
        // For device sources (and any other type), read from device_schemas.
        // device_schemas.source_id is the source slug, not UUID.
        const schemas = await deviceSchemaQueries.findBySource(
          orgId,
          source.slug,
        );
        metrics = schemas.map((s) => ({ name: s.metric, type: s.value_type }));
        break;
      }
    }

    return NextResponse.json(
      { source_id: source.id, source_type: source.source_type, metrics },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  },
);
