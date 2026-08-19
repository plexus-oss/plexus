import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const OLD_SECRET = process.env.AUTH_SECRET;
beforeAll(() => {
  process.env.AUTH_SECRET = "test-embed-secret-please-change";
});
afterAll(() => {
  process.env.AUTH_SECRET = OLD_SECRET;
});

// Imported after the secret is set (module reads env lazily inside functions).
import {
  mintEmbedToken,
  verifyEmbedToken,
  authorizeEmbedRead,
  clampTtl,
} from "@/lib/auth/embed-token";
import { isEmbedEntitled } from "@/lib/embed/entitlement";

const CLAIMS = { orgId: "org_test", dashboardId: "dash_1", panelId: "panel_bw" };

describe("clampTtl", () => {
  it("defaults, floors, and caps", () => {
    expect(clampTtl(undefined)).toBe(900);
    expect(clampTtl(10)).toBe(60); // floor
    expect(clampTtl(99999)).toBe(3600); // cap
    expect(clampTtl(1200)).toBe(1200);
    expect(clampTtl(Number.NaN)).toBe(900);
  });
});

describe("mint → verify roundtrip", () => {
  it("returns the exact scoped claims and an expiry", async () => {
    const { token, expiresAt, expiresIn } = await mintEmbedToken(CLAIMS);
    expect(expiresIn).toBe(900);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
    const claims = await verifyEmbedToken(token);
    expect(claims).toEqual(CLAIMS);
  });
});

describe("verifyEmbedToken rejects bad tokens", () => {
  it("rejects garbage", async () => {
    expect(await verifyEmbedToken("not.a.jwt")).toBeNull();
  });

  it("rejects a token signed with a different secret (tamper/forgery)", async () => {
    const { token } = await mintEmbedToken(CLAIMS);
    process.env.AUTH_SECRET = "a-different-secret";
    const claims = await verifyEmbedToken(token);
    process.env.AUTH_SECRET = "test-embed-secret-please-change";
    expect(claims).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { token } = await mintEmbedToken(CLAIMS, 60);
    // jose validates exp against the real clock; advance fake time past it.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 120_000);
    const claims = await verifyEmbedToken(token);
    vi.useRealTimers();
    expect(claims).toBeNull();
  });

  it("rejects a valid-signature JWT that lacks the embed scope", async () => {
    // A ws-token-shaped JWT (same secret, no scope claim) must NOT pass as embed.
    const { SignJWT } = await import("jose");
    const foreign = await new SignJWT({ org_id: "org_test" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("plexus-embed")
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    expect(await verifyEmbedToken(foreign)).toBeNull();
  });
});

describe("authorizeEmbedRead binds the token to one panel", () => {
  it("authorizes the exact dashboard+panel", async () => {
    const { token } = await mintEmbedToken(CLAIMS);
    const ok = await authorizeEmbedRead(token, {
      dashboardId: "dash_1",
      panelId: "panel_bw",
    });
    expect(ok).toEqual(CLAIMS);
  });

  it("DENIES a token for panel A used against panel B (cross-panel)", async () => {
    const { token } = await mintEmbedToken(CLAIMS);
    const denied = await authorizeEmbedRead(token, {
      dashboardId: "dash_1",
      panelId: "panel_other",
    });
    expect(denied).toBeNull();
  });

  it("DENIES a mismatched dashboard", async () => {
    const { token } = await mintEmbedToken(CLAIMS);
    const denied = await authorizeEmbedRead(token, {
      dashboardId: "dash_other",
      panelId: "panel_bw",
    });
    expect(denied).toBeNull();
  });
});

describe("isEmbedEntitled", () => {
  const OLD = process.env.PLEXUS_EMBED_ORG_ALLOWLIST;
  afterAll(() => {
    process.env.PLEXUS_EMBED_ORG_ALLOWLIST = OLD;
  });

  it("is false when no allowlist is set", () => {
    delete process.env.PLEXUS_EMBED_ORG_ALLOWLIST;
    expect(isEmbedEntitled("org_test")).toBe(false);
  });

  it("matches an org on the allowlist and rejects others", () => {
    process.env.PLEXUS_EMBED_ORG_ALLOWLIST = " org_test , org_two ";
    expect(isEmbedEntitled("org_test")).toBe(true);
    expect(isEmbedEntitled("org_two")).toBe(true);
    expect(isEmbedEntitled("org_none")).toBe(false);
    expect(isEmbedEntitled("")).toBe(false);
  });
});
