import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/embed-token", () => ({
  authorizeEmbedRead: vi.fn(),
  verifyEmbedToken: vi.fn(),
}));
vi.mock("@/lib/db/server", () => ({
  adminDashboardQueries: { findById: vi.fn() },
  adminEmbedOriginQueries: { findVerifiedOrigins: vi.fn() },
}));
vi.mock("@/lib/db/clickhouse", () => ({ queryTelemetry: vi.fn() }));
// Disable the shared query cache so each test deterministically hits the query.
vi.mock("@/lib/db/query-cache", () => ({
  singleflight: (_k: string, fn: () => unknown) => fn(),
  getCachedQuery: () => null,
  setCachedQuery: () => {},
  queryCacheKey: () => "test-key",
}));
vi.mock("@/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  getClientIp: vi.fn(() => "1.2.3.4"),
}));

import { authorizeEmbedRead, verifyEmbedToken } from "@/lib/auth/embed-token";
import { adminDashboardQueries, adminEmbedOriginQueries } from "@/lib/db/server";
import { queryTelemetry } from "@/lib/db/clickhouse";
import { GET, OPTIONS } from "@/app/api/embed/panel/route";

const mockAuthorize = vi.mocked(authorizeEmbedRead);
const mockVerifyToken = vi.mocked(verifyEmbedToken);
const mockFindById = vi.mocked(adminDashboardQueries.findById);
const mockVerified = vi.mocked(adminEmbedOriginQueries.findVerifiedOrigins);
const mockQuery = vi.mocked(queryTelemetry);

const ORIGIN = "https://app.example.com";

function req(
  query: Record<string, string>,
  headers: Record<string, string> = { "x-embed-token": "tok", origin: ORIGIN },
): NextRequest {
  const url = new URL("http://localhost/api/embed/panel");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url, { headers });
}

const metricsPanel = {
  id: "panel_bw",
  type: "line",
  title: "Bandwidth",
  metrics: ["src1:bandwidth"],
  config: {},
  dataSource: { type: "realtime" },
  layout: { x: 0, y: 0, w: 1, h: 1 },
};
const dashboard = [{ id: "dash_1", org_id: "org_test", config: { panels: [metricsPanel] } }];

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthorize.mockResolvedValue({ orgId: "org_test", dashboardId: "dash_1", panelId: "panel_bw" });
  mockVerifyToken.mockResolvedValue({ orgId: "org_test", dashboardId: "dash_1", panelId: "panel_bw" });
  mockVerified.mockResolvedValue([ORIGIN]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockFindById.mockResolvedValue(dashboard as any);
  mockQuery.mockResolvedValue([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { timestamp: "2026-01-01 00:00:00.000", value: 42, source_id: "src1", metric: "bandwidth" } as any,
  ]);
});

it("401 without a token", async () => {
  const res = await GET(req({ dashboardId: "dash_1", panelId: "panel_bw" }, { origin: ORIGIN }));
  expect(res.status).toBe(401);
});

it("resolves via the token when dashboardId/panelId are omitted", async () => {
  // No ids in the query — the token's claims identify the panel.
  const res = await GET(req({}));
  expect(res.status).toBe(200);
  expect(mockVerifyToken).toHaveBeenCalled();
});

it("401 when the token doesn't authorize this panel", async () => {
  mockAuthorize.mockResolvedValue(null);
  const res = await GET(req({ dashboardId: "dash_1", panelId: "panel_bw" }));
  expect(res.status).toBe(401);
});

it("403 when the request origin isn't a verified embed origin", async () => {
  const res = await GET(
    req({ dashboardId: "dash_1", panelId: "panel_bw" }, { "x-embed-token": "tok", origin: "https://evil.com" }),
  );
  expect(res.status).toBe(403);
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
});

it("404 when the panel isn't in the dashboard", async () => {
  mockAuthorize.mockResolvedValue({ orgId: "org_test", dashboardId: "dash_1", panelId: "ghost" });
  const res = await GET(req({ dashboardId: "dash_1", panelId: "ghost" }));
  expect(res.status).toBe(404);
});

it("501 for a connection-backed (sql) panel", async () => {
  const sqlPanel = { ...metricsPanel, dataSource: { type: "connection", sourceId: "c1", query: "select 1" } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockFindById.mockResolvedValue([{ id: "dash_1", org_id: "org_test", config: { panels: [sqlPanel] } }] as any);
  const res = await GET(req({ dashboardId: "dash_1", panelId: "panel_bw" }));
  expect(res.status).toBe(501);
});

it("200 returns panel-derived metric data with reflected CORS", async () => {
  const res = await GET(req({ dashboardId: "dash_1", panelId: "panel_bw" }));
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  const json = (await res.json()) as {
    panel: { id: string; title: string };
    data: Record<string, Array<{ timestamp: string; value: number }>>;
  };
  expect(json.panel.id).toBe("panel_bw");
  expect(json.data["src1:bandwidth"]).toEqual([
    { timestamp: "2026-01-01T00:00:00.000Z", value: 42, source_id: "src1" },
  ]);
  // Metrics came from stored config, NOT from any client param.
  expect(mockQuery).toHaveBeenCalledWith(
    expect.objectContaining({ orgId: "org_test", metrics: ["bandwidth"], sourceId: "src1" }),
  );
});

it("OPTIONS preflight reflects the origin", async () => {
  const res = await OPTIONS(req({}, { origin: ORIGIN }));
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
});
