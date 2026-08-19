import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db/server", () => ({
  adminEmbedPublishQueries: { findActiveByToken: vi.fn() },
}));

import { adminEmbedPublishQueries } from "@/lib/db/server";
import {
  EMBED_TOKEN_PREFIX,
  generateEmbedPublishToken,
  isDurableEmbedToken,
  resolveDurableToken,
} from "@/lib/embed/publish";

const mockFind = vi.mocked(adminEmbedPublishQueries.findActiveByToken);

beforeEach(() => vi.clearAllMocks());

describe("generateEmbedPublishToken", () => {
  it("carries the emb_ prefix and 48 hex chars of entropy", () => {
    const t = generateEmbedPublishToken();
    expect(t.startsWith(EMBED_TOKEN_PREFIX)).toBe(true);
    expect(t.slice(EMBED_TOKEN_PREFIX.length)).toMatch(/^[0-9a-f]{48}$/);
  });

  it("is unique across calls", () => {
    const seen = new Set(Array.from({ length: 50 }, generateEmbedPublishToken));
    expect(seen.size).toBe(50);
  });
});

describe("isDurableEmbedToken", () => {
  it("recognizes durable tokens and rejects short-lived JWTs", () => {
    expect(isDurableEmbedToken(generateEmbedPublishToken())).toBe(true);
    // A JWT (three base64url segments) is NOT a durable token.
    expect(isDurableEmbedToken("eyJhbGciOi.eyJvcmci.sig")).toBe(false);
    expect(isDurableEmbedToken("")).toBe(false);
  });
});

describe("resolveDurableToken", () => {
  it("maps an active row to its panel scope", async () => {
    mockFind.mockResolvedValue({
      org_id: "org_a",
      dashboard_id: "dash_1",
      panel_id: "panel_1",
      time_range: "7d",
    } as never);
    const scope = await resolveDurableToken("emb_abc");
    expect(scope).toEqual({
      orgId: "org_a",
      dashboardId: "dash_1",
      panelId: "panel_1",
      timeRange: "7d",
    });
  });

  it("normalizes a null time_range", async () => {
    mockFind.mockResolvedValue({
      org_id: "org_a",
      dashboard_id: "dash_1",
      panel_id: "panel_1",
      time_range: null,
    } as never);
    expect((await resolveDurableToken("emb_abc"))?.timeRange).toBeNull();
  });

  it("returns null for an unknown or revoked token", async () => {
    mockFind.mockResolvedValue(undefined as never);
    expect(await resolveDurableToken("emb_gone")).toBeNull();
  });
});
