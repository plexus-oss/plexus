import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { oauthAuthorizationCodes } from "../schema";
import { oauthQueries, verifyPkceS256 } from "../queries/oauth";

const ORG = "org-oauth-test";
const USER = "user-oauth-test";

// RFC 7636 Appendix B test vector.
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

async function makeClient() {
  return oauthQueries.registerClient({
    clientName: "Test MCP Client",
    redirectUris: ["https://client.example/callback"],
  });
}

async function makeCode(clientId: string) {
  return oauthQueries.createAuthorizationCode({
    clientId,
    orgId: ORG,
    userId: USER,
    redirectUri: "https://client.example/callback",
    codeChallenge: RFC_CHALLENGE,
    resource: "https://api.plexus.company/mcp",
  });
}

async function expireCode(code: string): Promise<void> {
  await db
    .update(oauthAuthorizationCodes)
    .set({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .where(eq(oauthAuthorizationCodes.code, code));
}

describe("verifyPkceS256", () => {
  it("accepts the RFC 7636 test vector", () => {
    expect(verifyPkceS256(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
  });

  it("rejects a wrong verifier", () => {
    expect(
      verifyPkceS256("a".repeat(43), RFC_CHALLENGE),
    ).toBe(false);
  });

  it("rejects malformed verifiers before hashing", () => {
    expect(verifyPkceS256("too-short", RFC_CHALLENGE)).toBe(false);
    expect(verifyPkceS256("bad chars!".padEnd(50, "x"), RFC_CHALLENGE)).toBe(
      false,
    );
    expect(verifyPkceS256("x".repeat(129), RFC_CHALLENGE)).toBe(false);
  });
});

describe("oauthQueries", () => {
  it("registers and finds a client", async () => {
    const client = await makeClient();
    expect(client.client_name).toBe("Test MCP Client");
    expect(client.token_endpoint_auth_method).toBe("none");

    const found = await oauthQueries.findClient(client.id);
    expect(found?.redirect_uris).toEqual(["https://client.example/callback"]);
  });

  it("returns undefined for a non-UUID client_id instead of throwing", async () => {
    const found = await oauthQueries.findClient("not-a-uuid'; DROP TABLE --");
    expect(found).toBeUndefined();
  });

  it("creates an issued code with future expiry", async () => {
    const client = await makeClient();
    const row = await makeCode(client.id);

    expect(row.status).toBe("issued");
    expect(row.code).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(row.org_id).toBe(ORG);
  });

  it("consumes a code exactly once (single winner)", async () => {
    const client = await makeClient();
    const row = await makeCode(client.id);

    const winner = await oauthQueries.consumeAuthorizationCode(row.code);
    expect(winner?.status).toBe("consumed");

    const loser = await oauthQueries.consumeAuthorizationCode(row.code);
    expect(loser).toBeUndefined();
  });

  it("does not consume an expired code", async () => {
    const client = await makeClient();
    const row = await makeCode(client.id);
    await expireCode(row.code);

    const consumed = await oauthQueries.consumeAuthorizationCode(row.code);
    expect(consumed).toBeUndefined();
  });

});
