import { describe, it, expect } from "vitest";
import { db } from "../client";
import { dashboards, dashboardViews } from "../schema";
import { dashboardViewQueries } from "../queries/dashboards";

const ORG = "test-org";
const DASHBOARD_ID = "00000000-0000-0000-0000-000000000001";

async function ensureDashboard(): Promise<void> {
  await db
    .insert(dashboards)
    .values({
      id: DASHBOARD_ID,
      org_id: ORG,
      name: "Test Dashboard",
      config: {},
      visibility: "org",
    } as typeof dashboards.$inferInsert)
    .onConflictDoNothing();
}

async function insertView(
  sessionId: string,
  startedAt: Date,
  durationSeconds: number | null = null,
): Promise<void> {
  await db.insert(dashboardViews).values({
    org_id: ORG,
    dashboard_id: DASHBOARD_ID,
    session_id: sessionId,
    started_at: startedAt.toISOString(),
    duration_seconds: durationSeconds,
  } as typeof dashboardViews.$inferInsert);
}

describe("dashboardViewQueries.getStats", () => {
  it("computes total views, unique viewers, and avg duration", async () => {
    await ensureDashboard();

    const now = new Date();
    await insertView("sess-1", now, 10);
    await insertView("sess-2", now, 20);
    await insertView("sess-1", now, null);
    await insertView("sess-3", now, 30);
    await insertView("sess-2", now, 40);

    const stats = await dashboardViewQueries.getStats(ORG, DASHBOARD_ID, 30, 0);

    expect(stats.totalViews).toBe(5);
    expect(stats.uniqueViewers).toBe(3);
    expect(stats.avgDuration).toBe(25);
  });

  it("returns zeros when there are no views in the window", async () => {
    await ensureDashboard();

    const stats = await dashboardViewQueries.getStats(ORG, DASHBOARD_ID, 30, 0);

    expect(stats).toEqual({ totalViews: 0, uniqueViewers: 0, avgDuration: 0 });
  });

  it("respects the offset window (excludes recent views)", async () => {
    await ensureDashboard();

    const now = new Date();
    const midRange = new Date(now);
    midRange.setDate(midRange.getDate() - 45);

    await insertView("mid-sess", midRange, 100);
    await insertView("recent-sess", now, 200);

    const stats = await dashboardViewQueries.getStats(ORG, DASHBOARD_ID, 30, 30);

    expect(stats.totalViews).toBe(1);
    expect(stats.uniqueViewers).toBe(1);
    expect(stats.avgDuration).toBe(100);
  });
});

describe("dashboardViewQueries.getViewsByDay", () => {
  it("groups views by day and fills zero-view days", async () => {
    await ensureDashboard();

    const now = new Date();
    const day1 = new Date(now);
    day1.setDate(day1.getDate() - 2);
    const day3 = new Date(now);

    await insertView("s1", day1);
    await insertView("s2", day1);
    await insertView("s3", day1);
    await insertView("s4", day3);
    await insertView("s5", day3);

    const result = await dashboardViewQueries.getViewsByDay(ORG, DASHBOARD_ID, 3);

    expect(result).toHaveLength(4);
    const day1Str = day1.toISOString().split("T")[0];
    const day3Str = day3.toISOString().split("T")[0];

    const day1Entry = result.find((r) => r.date === day1Str);
    const day3Entry = result.find((r) => r.date === day3Str);
    expect(day1Entry?.views).toBe(3);
    expect(day3Entry?.views).toBe(2);

    const zeroDay = result.find((r) => r.views === 0);
    expect(zeroDay).toBeDefined();
  });

  it("returns all zero-view days when no views exist", async () => {
    await ensureDashboard();

    const result = await dashboardViewQueries.getViewsByDay(ORG, DASHBOARD_ID, 3);

    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.every((r) => r.views === 0)).toBe(true);
  });

  it("clusters views on the same day correctly", async () => {
    await ensureDashboard();

    const today = new Date();
    const morning = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 6, 0, 0));
    const evening = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 18, 0, 0));

    await insertView("s1", morning);
    await insertView("s2", evening);

    const result = await dashboardViewQueries.getViewsByDay(ORG, DASHBOARD_ID, 1);

    const todayStr = morning.toISOString().split("T")[0];
    const todayEntry = result.find((r) => r.date === todayStr);
    expect(todayEntry?.views).toBe(2);
  });
});
