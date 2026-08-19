import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/embed/resolve-panel", async (orig) => {
  const actual = await orig<typeof import("@/lib/embed/resolve-panel")>();
  return { ...actual, resolveEmbedPanel: vi.fn() };
});
vi.mock("@/lib/db/server", () => ({
  adminEmbedOriginQueries: { findVerifiedOrigins: vi.fn() },
}));
vi.mock("@/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  getClientIp: vi.fn(() => "1.2.3.4"),
}));

import { resolveEmbedPanel } from "@/lib/embed/resolve-panel";
import { adminEmbedOriginQueries } from "@/lib/db/server";
import { POST } from "@/app/api/embed/panels/route";

const mockResolve = vi.mocked(resolveEmbedPanel);
const mockVerified = vi.mocked(adminEmbedOriginQueries.findVerifiedOrigins);
const ORIGIN = "https://app.example.com";

function req(body: unknown, origin = ORIGIN): NextRequest {
  return new NextRequest("http://localhost/api/embed/panels", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerified.mockResolvedValue([ORIGIN]);
});

it("400 when items[] is missing or empty", async () => {
  expect((await POST(req({}))).status).toBe(400);
  expect((await POST(req({ items: [] }))).status).toBe(400);
});

it("400 when the batch exceeds the item cap", async () => {
  const items = Array.from({ length: 21 }, () => ({ token: "t", dashboardId: "d", panelId: "p" }));
  expect((await POST(req({ items }))).status).toBe(400);
});

it("400 on a cross-org batch", async () => {
  mockResolve
    .mockResolvedValueOnce({ orgId: "org_a", panel: { id: "p1", type: "line", title: "A" }, data: {} })
    .mockResolvedValueOnce({ orgId: "org_b", panel: { id: "p2", type: "line", title: "B" }, data: {} });
  const res = await POST(
    req({ items: [{ token: "t1", dashboardId: "d", panelId: "p1" }, { token: "t2", dashboardId: "d", panelId: "p2" }] }),
  );
  expect(res.status).toBe(400);
});

it("403 when the origin isn't verified for the org", async () => {
  mockResolve.mockResolvedValue({ orgId: "org_a", panel: { id: "p1", type: "line", title: "A" }, data: {} });
  const res = await POST(
    req({ items: [{ token: "t1", dashboardId: "d", panelId: "p1" }] }, "https://evil.com"),
  );
  expect(res.status).toBe(403);
});

it("200 returns per-item results (data + errors) with CORS", async () => {
  mockResolve
    .mockResolvedValueOnce({
      orgId: "org_a",
      panel: { id: "p1", type: "line", title: "Bandwidth" },
      data: { "s:m": [{ timestamp: "t", value: 1, source_id: "s" }] },
    })
    .mockResolvedValueOnce({ orgId: "org_a", error: "Panel not found", status: 404 });
  const res = await POST(
    req({
      items: [
        { token: "t1", dashboardId: "d", panelId: "p1" },
        { token: "t2", dashboardId: "d", panelId: "p2" },
      ],
    }),
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  const json = (await res.json()) as {
    results: Array<{ panelId: string; panel?: unknown; error?: string }>;
  };
  expect(json.results).toHaveLength(2);
  expect(json.results[0].panel).toEqual({ id: "p1", type: "line", title: "Bandwidth" });
  expect(json.results[1].error).toBe("Panel not found");
  expect(json.results[1].panelId).toBe("p2");
});

describe("smoke", () => {
  it("exports POST", () => expect(typeof POST).toBe("function"));
});
