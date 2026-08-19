import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Mock the two external dependencies so the test exercises the route's guard
// chain (entitlement → ownership → panel-exists → mint) without a DB or key store.
vi.mock("@/lib/api-keys", () => ({ authenticateRequest: vi.fn() }));
vi.mock("@/lib/db/server", () => ({
  adminDashboardQueries: { findById: vi.fn() },
}));

import { authenticateRequest } from "@/lib/api-keys";
import { adminDashboardQueries } from "@/lib/db/server";
import { verifyEmbedToken } from "@/lib/auth/embed-token";
import { POST } from "@/app/api/embed/token/route";

const mockAuth = vi.mocked(authenticateRequest);
const mockFindById = vi.mocked(adminDashboardQueries.findById);

beforeAll(() => {
  process.env.AUTH_SECRET = "test-embed-secret";
  process.env.PLEXUS_EMBED_ORG_ALLOWLIST = "org_test";
});

function req(
  body: unknown,
  headers: Record<string, string> = { "x-api-key": "plx_test" },
): NextRequest {
  return new Request("http://localhost/api/embed/token", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

const okAuth = {
  success: true as const,
  orgId: "org_test",
  authMethod: "api_key" as const,
  keyId: "k1",
  scopes: ["read"],
};
const ownedDashboard = [
  { id: "dash_1", org_id: "org_test", config: { panels: [{ id: "panel_bw" }] } },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(okAuth);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockFindById.mockResolvedValue(ownedDashboard as any);
});

it("401 without an x-api-key header (never mintable from a browser)", async () => {
  const res = await POST(req({ dashboardId: "dash_1", panelId: "panel_bw" }, {}));
  expect(res.status).toBe(401);
});

it("propagates an auth failure status", async () => {
  mockAuth.mockResolvedValue({ success: false, error: "Invalid API key", status: 401 });
  const res = await POST(req({ dashboardId: "dash_1", panelId: "panel_bw" }));
  expect(res.status).toBe(401);
});

it("403 when the org is not entitled to embed", async () => {
  mockAuth.mockResolvedValue({ ...okAuth, orgId: "org_none" });
  const res = await POST(req({ dashboardId: "dash_1", panelId: "panel_bw" }));
  expect(res.status).toBe(403);
});

it("400 when dashboardId/panelId are missing", async () => {
  const res = await POST(req({ panelId: "panel_bw" }));
  expect(res.status).toBe(400);
});

it("400 on invalid JSON", async () => {
  const res = await POST(req("{not json", { "x-api-key": "plx_test" }));
  expect(res.status).toBe(400);
});

it("404 when the dashboard is not owned by the org", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockFindById.mockResolvedValue([] as any);
  const res = await POST(req({ dashboardId: "dash_other", panelId: "panel_bw" }));
  expect(res.status).toBe(404);
  expect(mockFindById).toHaveBeenCalledWith("org_test", "dash_other");
});

it("404 when the panel is not in the dashboard", async () => {
  const res = await POST(req({ dashboardId: "dash_1", panelId: "panel_ghost" }));
  expect(res.status).toBe(404);
});

it("200 mints a token scoped to the requested org+dashboard+panel", async () => {
  const res = await POST(req({ dashboardId: "dash_1", panelId: "panel_bw" }));
  expect(res.status).toBe(200);
  const json = (await res.json()) as { token: string; expiresIn: number };
  expect(json.expiresIn).toBe(900);
  const claims = await verifyEmbedToken(json.token);
  expect(claims).toEqual({
    orgId: "org_test",
    dashboardId: "dash_1",
    panelId: "panel_bw",
  });
});

it("honors a clamped custom TTL", async () => {
  const res = await POST(
    req({ dashboardId: "dash_1", panelId: "panel_bw", expiresIn: 30 }),
  );
  const json = (await res.json()) as { expiresIn: number };
  expect(json.expiresIn).toBe(60); // floored
});

describe("smoke", () => {
  it("route module exports a POST handler", () => {
    expect(typeof POST).toBe("function");
  });
});
