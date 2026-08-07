import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import {
  dashboardQueries,
  dashboardViewQueries,
  dashboardShareLinkQueries,
} from "@/lib/db";
import type { DashboardViewAnalytics } from "@/lib/db/types";

/**
 * Calculate percentage change between two values
 */
function calculateTrend(
  current: number,
  previous: number
): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Extract hostname from referrer URL
 */
function getReferrerSource(referrer: string | null): string {
  if (!referrer) return "Direct";
  try {
    const url = new URL(referrer);
    // Clean up common referrers
    const hostname = url.hostname.replace(/^www\./, "");
    if (hostname.includes("google")) return "Google";
    if (hostname.includes("twitter") || hostname.includes("x.com")) return "Twitter/X";
    if (hostname.includes("linkedin")) return "LinkedIn";
    if (hostname.includes("facebook")) return "Facebook";
    if (hostname.includes("github")) return "GitHub";
    return hostname;
  } catch {
    return "Direct";
  }
}

/**
 * GET /api/dashboards/[id]/analytics - Get view analytics for a dashboard
 */
export const GET = withAuth(async (request, { orgId, params }) => {
  const { id: dashboardId } = await params;
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30", 10);

  // Verify dashboard exists and belongs to org
  const dashboard = await dashboardQueries.findById(orgId, dashboardId);
  if (!dashboard[0]) {
    return NextResponse.json(
      { error: "Dashboard not found" },
      { status: 404 }
    );
  }

  // Get analytics data in parallel - current period and previous period for trends
  const [stats, previousStats, viewsByDay, recentViews, shareLinks] =
    await Promise.all([
      dashboardViewQueries.getStats(orgId, dashboardId, days),
      dashboardViewQueries.getStats(orgId, dashboardId, days, days), // Previous period
      dashboardViewQueries.getViewsByDay(orgId, dashboardId, days),
      dashboardViewQueries.findByDashboard(orgId, dashboardId, { limit: 100 }),
      dashboardShareLinkQueries.findByDashboard(orgId, dashboardId),
    ]);

  // Calculate trends
  const trends = {
    views: calculateTrend(stats.totalViews, previousStats.totalViews),
    viewers: calculateTrend(stats.uniqueViewers, previousStats.uniqueViewers),
    duration: calculateTrend(stats.avgDuration, previousStats.avgDuration),
  };

  // Calculate views by country
  const countryMap: Record<string, number> = {};
  for (const view of recentViews) {
    const country = view.country || "Unknown";
    countryMap[country] = (countryMap[country] || 0) + 1;
  }
  const viewsByCountry = Object.entries(countryMap)
    .map(([country, views]) => ({ country, views }))
    .sort((a, b) => b.views - a.views);

  // Calculate views by referrer
  const referrerMap: Record<string, number> = {};
  for (const view of recentViews) {
    const source = getReferrerSource(view.referrer);
    referrerMap[source] = (referrerMap[source] || 0) + 1;
  }
  const viewsByReferrer = Object.entries(referrerMap)
    .map(([source, views]) => ({ source, views }))
    .sort((a, b) => b.views - a.views);

  // Build share link ID to name map
  const shareLinkMap = new Map(
    shareLinks.map((link) => [link.id, link.name])
  );

  // Calculate per-share-link stats
  const shareLinkStatsMap: Record<
    string,
    { views: number; sessions: Set<string>; lastViewedAt: string | null }
  > = {};
  for (const view of recentViews) {
    if (!view.share_link_id) continue;
    if (!shareLinkStatsMap[view.share_link_id]) {
      shareLinkStatsMap[view.share_link_id] = {
        views: 0,
        sessions: new Set(),
        lastViewedAt: null,
      };
    }
    const stat = shareLinkStatsMap[view.share_link_id];
    stat.views++;
    stat.sessions.add(view.session_id);
    if (!stat.lastViewedAt || view.started_at > stat.lastViewedAt) {
      stat.lastViewedAt = view.started_at;
    }
  }

  const shareLinkStats = shareLinks
    .map((link) => ({
      id: link.id,
      name: link.name,
      views: shareLinkStatsMap[link.id]?.views || 0,
      uniqueViewers: shareLinkStatsMap[link.id]?.sessions.size || 0,
      lastViewedAt: shareLinkStatsMap[link.id]?.lastViewedAt || null,
    }))
    .sort((a, b) => b.views - a.views);

  const analytics: DashboardViewAnalytics = {
    totalViews: stats.totalViews,
    uniqueViewers: stats.uniqueViewers,
    averageDuration: stats.avgDuration,
    trends,
    viewsByDay,
    viewsByCountry,
    viewsByReferrer,
    shareLinkStats,
    recentViews: recentViews.slice(0, 20).map((v) => ({
      id: v.id,
      startedAt: v.started_at,
      duration: v.duration_seconds,
      country: v.country,
      city: v.city,
      referrer: v.referrer,
      shareLinkName: v.share_link_id
        ? shareLinkMap.get(v.share_link_id) || null
        : null,
    })),
  };

  return NextResponse.json({ analytics });
});
