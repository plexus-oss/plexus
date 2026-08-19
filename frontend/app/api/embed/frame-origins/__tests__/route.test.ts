import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/embed/publish", async (orig) => {
  const actual = await orig<typeof import("@/lib/embed/publish")>();
  return { ...actual, resolveDurableToken: vi.fn() };
});
vi.mock("@/lib/db/server", () => ({
  adminEmbedOriginQueries: { findVerifiedOrigins: vi.fn() },
}));

import { resolveDurableToken } from "@/lib/embed/publish";
import { adminEmbedOriginQueries } from "@/lib/db/server";
import { GET } from "@/app/api/embed/frame-origins/route";

const mockResolve = vi.mocked(resolveDurableToken);
const mockOrigins = vi.mocked(adminEmbedOriginQueries.findVerifiedOrigins);

function get(token: string | null) {
  const url = token === null
    ? "http://localhost/api/embed/frame-origins"
    : `http://localhost/api/embed/frame-origins?token=${encodeURIComponent(token)}`;
  return GET(new Request(url));
}

beforeEach(() => vi.clearAllMocks());

it("returns [] for a missing token without hitting the DB", async () => {
  expect(await (await get(null)).json()).toEqual({ origins: [] });
  expect(mockResolve).not.toHaveBeenCalled();
});

it("returns [] for a non-durable token (JWT) without a lookup", async () => {
  expect(await (await get("eyJ.a.b")).json()).toEqual({ origins: [] });
  expect(mockResolve).not.toHaveBeenCalled();
});

it("returns [] for an unknown/revoked durable token", async () => {
  mockResolve.mockResolvedValue(null);
  expect(await (await get("emb_gone")).json()).toEqual({ origins: [] });
  expect(mockOrigins).not.toHaveBeenCalled();
});

it("returns the org's verified origins for an active token", async () => {
  mockResolve.mockResolvedValue({
    orgId: "org_a",
    dashboardId: "d",
    panelId: "p",
    timeRange: null,
  });
  mockOrigins.mockResolvedValue(["https://app.example.com"]);
  const res = await get("emb_live");
  expect(await res.json()).toEqual({ origins: ["https://app.example.com"] });
  expect(mockOrigins).toHaveBeenCalledWith("org_a");
  expect(res.headers.get("cache-control")).toContain("max-age=60");
});
