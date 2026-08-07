/**
 * Source Associations API — discovered entity ↔ connection-table links.
 *
 * GET /api/sources/[id]/associations — list the connection-table slices that
 * feed this source (written by the discovery loop), each enriched with the
 * connection's slug + name so clients can link/fetch without a second lookup.
 */

import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { findSourceByRef } from "@/lib/api/find-source";
import { enforceSource } from "@/lib/access/sources";
import { sourceAssociationQueries, sourceQueries } from "@/lib/db";

export const GET = withDualAuth(
  async (_request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
    const { id } = await params;
    const source = await findSourceByRef(orgId, id, isApiKeyAuth);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    await enforceSource(
      { orgId, userId, orgRole, isApiKeyAuth },
      source,
      "view",
    );

    const rows = await sourceAssociationQueries.findByEntity(orgId, source.id);

    // Batch-enrich with the owning connection's slug + name.
    const connectionIds = [...new Set(rows.map((r) => r.connection_id))];
    const connections = await sourceQueries.findByIds(orgId, connectionIds);
    const byId = new Map(connections.map((c) => [c.id, c]));

    const associations = rows.map((r) => {
      const connection = byId.get(r.connection_id);
      return {
        ...r,
        connection_slug: connection?.slug ?? null,
        connection_name: connection?.name ?? null,
      };
    });

    return NextResponse.json({ associations });
  },
);
