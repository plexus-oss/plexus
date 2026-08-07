import { desc, eq } from "drizzle-orm";
import { db } from "../client";
import { dashboardIconAssets } from "../schema";
import { createOrgQueries } from "./shared";
import type { DashboardIconAsset, NewDashboardIconAsset } from "../types";

export const dashboardIconAssetQueries = {
  ...createOrgQueries<DashboardIconAsset, NewDashboardIconAsset>(dashboardIconAssets),

  findAllOrdered: async (orgId: string): Promise<DashboardIconAsset[]> =>
    (await db
      .select()
      .from(dashboardIconAssets)
      .where(eq(dashboardIconAssets.org_id, orgId))
      .orderBy(desc(dashboardIconAssets.created_at))) as DashboardIconAsset[],
};
