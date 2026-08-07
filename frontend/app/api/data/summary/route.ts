import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { getDataSummaryBySource } from "@/lib/db/clickhouse";
import { filterAccessibleSlugs } from "@/lib/access/sources";

export const GET = withDualAuth(
  async (_request, { orgId, userId, orgRole, isApiKeyAuth }) => {
    let breakdown = await getDataSummaryBySource(orgId);
    // Scoped members only see rows for sources they may view (ClickHouse
    // source_id holds the device slug).
    if (!isApiKeyAuth && userId) {
      const ok = await filterAccessibleSlugs(
        { orgId, userId, orgRole, isApiKeyAuth },
        breakdown.map((b) => b.source_id),
      );
      breakdown = breakdown.filter((b) => ok.has(b.source_id));
    }
    return NextResponse.json({ breakdown });
  },
);
