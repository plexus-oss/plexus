/**
 * OAuth 2.1 authorization-server queries (MCP connector flow).
 *
 * Clients register anonymously (RFC 7591, rate-limited at the route);
 * authorization codes are created by a signed-in admin's consent and redeemed
 * anonymously at the token endpoint — so these run on the admin pool and the
 * routes are responsible for gating, same as device-auth.ts.
 *
 * Code lifecycle: issued → consumed (token exchange, exactly once) — rows past
 * expires_at are dead regardless of status.
 */

import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "crypto";

import { and, eq, gt } from "drizzle-orm";

import { db } from "../client";
import { oauthAuthorizationCodes, oauthClients } from "../schema";

export const AUTH_CODE_TTL_SECONDS = 10 * 60;

export type OauthClient = typeof oauthClients.$inferSelect;
export type OauthAuthorizationCode =
  typeof oauthAuthorizationCodes.$inferSelect;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RFC 7636 §4.1: code_verifier is 43–128 chars of the unreserved set.
const CODE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

/** Constant-time S256 PKCE check: BASE64URL(SHA256(verifier)) == challenge. */
export function verifyPkceS256(
  codeVerifier: string,
  codeChallenge: string,
): boolean {
  if (!CODE_VERIFIER_RE.test(codeVerifier)) return false;
  const digest = createHash("sha256").update(codeVerifier).digest("base64url");
  const a = Buffer.from(digest);
  const b = Buffer.from(codeChallenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const oauthQueries = {
  registerClient: async (input: {
    clientName: string;
    redirectUris: string[];
    logoUri?: string | null;
    clientUri?: string | null;
  }): Promise<OauthClient> => {
    const rows = await db
      .insert(oauthClients)
      .values({
        client_name: input.clientName,
        redirect_uris: input.redirectUris,
        logo_uri: input.logoUri ?? null,
        client_uri: input.clientUri ?? null,
      })
      .returning();
    return rows[0];
  },

  findClient: async (clientId: string): Promise<OauthClient | undefined> => {
    // client_id is attacker-controlled; a non-UUID string would make
    // Postgres throw on the uuid cast, so pre-screen it.
    if (!UUID_RE.test(clientId)) return undefined;
    const rows = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.id, clientId));
    return rows[0];
  },

  createAuthorizationCode: async (input: {
    clientId: string;
    orgId: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    scope?: string | null;
    resource: string;
  }): Promise<OauthAuthorizationCode> => {
    const rows = await db
      .insert(oauthAuthorizationCodes)
      .values({
        code: randomBytes(32).toString("hex"),
        client_id: input.clientId,
        org_id: input.orgId,
        user_id: input.userId,
        redirect_uri: input.redirectUri,
        code_challenge: input.codeChallenge,
        scope: input.scope ?? null,
        resource: input.resource,
        expires_at: new Date(
          Date.now() + AUTH_CODE_TTL_SECONDS * 1000,
        ).toISOString(),
      })
      .returning();
    return rows[0];
  },

  /**
   * Atomically flip issued → consumed so a code redeems exactly once, even
   * under concurrent token requests. Returns the row only to the winner.
   */
  consumeAuthorizationCode: async (
    code: string,
  ): Promise<OauthAuthorizationCode | undefined> => {
    const rows = await db
      .update(oauthAuthorizationCodes)
      .set({ status: "consumed" })
      .where(
        and(
          eq(oauthAuthorizationCodes.code, code),
          eq(oauthAuthorizationCodes.status, "issued"),
          gt(oauthAuthorizationCodes.expires_at, new Date().toISOString()),
        ),
      )
      .returning();
    return rows[0];
  },

  attachApiKey: async (code: string, apiKeyId: string): Promise<void> => {
    await db
      .update(oauthAuthorizationCodes)
      .set({ api_key_id: apiKeyId })
      .where(eq(oauthAuthorizationCodes.code, code));
  },
};
