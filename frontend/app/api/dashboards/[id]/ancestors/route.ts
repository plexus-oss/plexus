import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { dashboardQueries } from "@/lib/db";

interface BreadcrumbItem {
  id: string;
  name: string;
  icon: string | null;
  icon_url: string | null;
}

/**
 * GET /api/dashboards/[id]/ancestors - Get ancestor chain for breadcrumb
 * Returns ancestors from root to immediate parent (not including current dashboard)
 */
export const GET = withAuth(async (_request, { orgId, params }) => {
  const { id } = await params;

  // Get the current dashboard
  const result = await dashboardQueries.findById(orgId, id);
  const dashboard = result[0];

  if (!dashboard) {
    return NextResponse.json(
      { error: "Dashboard not found" },
      { status: 404 }
    );
  }

  // If no parent, return empty ancestors
  if (!dashboard.parent_id) {
    return NextResponse.json({ ancestors: [] });
  }

  // Batch-fetch all dashboards to walk ancestor chain in memory (avoids N+1)
  const allDashboards = await dashboardQueries.findAll(orgId);
  const dashboardMap = new Map(allDashboards.map((d) => [d.id, d]));

  const ancestors: BreadcrumbItem[] = [];
  let currentParentId: string | null = dashboard.parent_id;
  const visited = new Set<string>(); // Prevent infinite loops

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);

    const parent = dashboardMap.get(currentParentId);
    if (!parent) break;

    ancestors.unshift({
      id: parent.id,
      name: parent.name,
      icon: parent.icon,
      icon_url: parent.icon_url,
    });
    currentParentId = parent.parent_id;
  }

  return NextResponse.json({ ancestors });
});
