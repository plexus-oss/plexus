import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Session-authed via withRoleAuth; mock to a pass-through so we test the route
// logic (ownership + shaping), not the auth wrapper.
vi.mock("@/lib/api/with-auth", () => ({
  withRoleAuth: (_roles: string[], handler: unknown) => handler,
}));
vi.mock("@/lib/db/server", () => ({
  adminDashboardQueries: { findById: vi.fn() },
  adminEmbedPublishQueries: {
    findAllForPanel: vi.fn(),
    create: vi.fn(),
    revoke: vi.fn(),
  },
}));
vi.mock("@/lib/embed/publish", () => ({
  generateEmbedPublishToken: () => "emb_deadbeef",
}));

import { NextRequest as NR } from "next/server";
import { adminDashboardQueries, adminEmbedPublishQueries } from "@/lib/db/server";
import { GET, POST } from "@/app/api/embed/publishes/route";
import { DELETE } from "@/app/api/embed/publishes/[id]/route";

const mockDash = vi.mocked(adminDashboardQueries.findById);
const mockFindAll = vi.mocked(adminEmbedPublishQueries.findAllForPanel);
const mockCreate = vi.mocked(adminEmbedPublishQueries.create);
const mockRevoke = vi.mocked(adminEmbedPublishQueries.revoke);

const ctx = { orgId: "org_a", userId: "u1", orgRole: "org:admin" };
function get(qs: string) {
  return (GET as never as (r: NextRequest, c: unknown) => Promise<Response>)(
    new NR(`http://localhost/api/embed/publishes?${qs}`),
    ctx,
  );
}
function post(body: unknown) {
  return (POST as never as (r: NextRequest, c: unknown) => Promise<Response>)(
    new NR("http://localhost/api/embed/publishes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx,
  );
}
function del(id: string) {
  return (DELETE as never as (r: NextRequest, c: unknown) => Promise<Response>)(
    {} as NextRequest,
    { ...ctx, params: Promise.resolve({ id }) },
  );
}

const row = {
  id: "pub_1",
  token: "emb_deadbeef",
  label: null,
  time_range: null,
  created_at: "2026-08-19T00:00:00Z",
  revoked_at: null,
};

beforeEach(() => vi.clearAllMocks());

describe("GET /api/embed/publishes", () => {
  it("400 without dashboardId + panelId", async () => {
    expect((await get("dashboardId=d")).status).toBe(400);
  });

  it("returns only active (non-revoked) publishes", async () => {
    mockFindAll.mockResolvedValue([
      row,
      { ...row, id: "pub_2", token: "emb_old", revoked_at: "2026-08-18T00:00:00Z" },
    ] as never);
    const res = await get("dashboardId=d&panelId=p");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { publishes: Array<{ id: string; token: string }> };
    expect(json.publishes).toHaveLength(1);
    expect(json.publishes[0]).toMatchObject({ id: "pub_1", token: "emb_deadbeef", revoked: false });
  });
});

describe("POST /api/embed/publishes", () => {
  it("404 when the dashboard isn't owned by the org", async () => {
    mockDash.mockResolvedValue([] as never);
    expect((await post({ dashboardId: "d", panelId: "p" })).status).toBe(404);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("404 when the panel isn't in the dashboard", async () => {
    mockDash.mockResolvedValue([{ config: { panels: [{ id: "other" }] } }] as never);
    expect((await post({ dashboardId: "d", panelId: "p" })).status).toBe(404);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("201 mints a durable token for an owned panel", async () => {
    mockDash.mockResolvedValue([{ config: { panels: [{ id: "p" }] } }] as never);
    mockCreate.mockResolvedValue(row as never);
    const res = await post({ dashboardId: "d", panelId: "p" });
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      "org_a",
      expect.objectContaining({ dashboard_id: "d", panel_id: "p", token: "emb_deadbeef", created_by: "u1" }),
    );
    expect((await res.json()) as unknown).toMatchObject({ token: "emb_deadbeef", revoked: false });
  });
});

describe("DELETE /api/embed/publishes/[id]", () => {
  it("404 when nothing was revoked for this org", async () => {
    mockRevoke.mockResolvedValue(undefined as never);
    expect((await del("pub_x")).status).toBe(404);
  });

  it("revokes scoped to the org", async () => {
    mockRevoke.mockResolvedValue(row as never);
    expect((await del("pub_1")).status).toBe(200);
    expect(mockRevoke).toHaveBeenCalledWith("org_a", "pub_1");
  });
});
