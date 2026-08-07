import { withAuth } from "@/lib/api/with-auth";
import { sourceQueries, alertQueries } from "@/lib/db";
import { sourceGroupQueries } from "@/lib/db/supabase";
import { loadAllowedSourceIds } from "@/lib/access/sources";
import { cachedJson } from "@/lib/utils";
import type { Source, SourceType, SourceHealthSummary, SourceGroup } from "@/lib/db/types";

/**
 * Determine source status based on last_seen_at
 */
function computeStatus(
  lastSeenAt: string | null
): "online" | "offline" | "unknown" {
  if (!lastSeenAt) return "unknown";
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  return new Date(lastSeenAt).getTime() > fiveMinutesAgo ? "online" : "offline";
}

/**
 * Categorize health score
 */
function categorizeHealthScore(
  score: number | null
): "healthy" | "degraded" | "unhealthy" | "unknown" {
  if (score === null) return "unknown";
  if (score >= 80) return "healthy";
  if (score >= 50) return "degraded";
  return "unhealthy";
}

/**
 * GET /api/sources/health - Get source health summary
 * Accepts optional ?type=device filter to only include device-type sources.
 */
export const GET = withAuth(async (request, { orgId, userId }) => {
  const { searchParams } = new URL(request.url);
  const typeFilter = searchParams.get("type");

  // Get sources - optionally filtered by type
  let sources: Source[];
  if (typeFilter) {
    sources = await sourceQueries.findByType(orgId, typeFilter as SourceType);
  } else {
    sources = await sourceQueries.findAll(orgId);
  }

  // Scoped members only see health for their allow-listed sources.
  const allowed = await loadAllowedSourceIds(orgId, userId);
  if (allowed) sources = sources.filter((s) => allowed.has(s.id));

  // Get all source groups with counts
  const groups = await sourceGroupQueries.findAllWithCounts(orgId);

  // Get recent open alerts count (last 24 hours)
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  const openAlerts = await alertQueries.findAll(orgId, {
    status: ["open", "acknowledged"],
    limit: 1000,
  });
  const recentAlerts = openAlerts.filter(
    (a) => new Date(a.triggered_at) > oneDayAgo
  ).length;

  // Compute status and health for each source
  const sourcesWithStatus = sources.map((source) => ({
    id: source.id,
    type: source.device_type,
    status: computeStatus(source.last_seen_at),
    healthScore: (source as Source & { health_score?: number | null })
      .health_score,
  }));

  // Calculate basic health metrics
  const total = sourcesWithStatus.length;
  const online = sourcesWithStatus.filter(
    (s) => s.status === "online"
  ).length;
  const offline = sourcesWithStatus.filter(
    (s) => s.status === "offline"
  ).length;
  const unknown = sourcesWithStatus.filter(
    (s) => s.status === "unknown"
  ).length;

  // Count source types
  const byType: Record<string, number> = {};
  for (const source of sourcesWithStatus) {
    const type = source.type || "unknown";
    byType[type] = (byType[type] || 0) + 1;
  }

  // Count by health score category
  const byHealthScore = {
    healthy: 0,
    degraded: 0,
    unhealthy: 0,
    unknown: 0,
  };
  for (const source of sourcesWithStatus) {
    const category = categorizeHealthScore(source.healthScore ?? null);
    byHealthScore[category]++;
  }

  // Calculate group health metrics
  const groupHealth = await Promise.all(
    groups.map(async (group: SourceGroup & { member_count?: number }) => {
      let members = await sourceGroupQueries.computeMembers(orgId, group);
      if (allowed) members = members.filter((m: Source) => allowed.has(m.id));
      const memberStatuses = members.map((m: Source) => ({
        status: computeStatus(m.last_seen_at),
        healthScore: (m as Source & { health_score?: number | null })
          .health_score,
      }));

      const onlineCount = memberStatuses.filter(
        (m: { status: string; healthScore?: number | null }) => m.status === "online"
      ).length;

      const healthScores = memberStatuses
        .map((m: { status: string; healthScore?: number | null }) => m.healthScore)
        .filter((s: number | null | undefined): s is number => s !== null && s !== undefined);

      const averageHealthScore =
        healthScores.length > 0
          ? Math.round(
              healthScores.reduce((a: number, b: number) => a + b, 0) / healthScores.length
            )
          : null;

      return {
        id: group.id,
        name: group.name,
        color: group.color || undefined,
        memberCount: members.length,
        onlineCount,
        averageHealthScore,
      };
    })
  );

  const summary: SourceHealthSummary = {
    total,
    online,
    offline,
    unknown,
    byType,
    byHealthScore,
    groups: groupHealth,
    recentAlerts,
  };

  // Cache for 10 seconds - health data updates frequently
  return cachedJson(summary, { maxAge: 10, staleWhileRevalidate: 30 });
});
