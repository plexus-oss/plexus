/**
 * Embed tokens — browser-safe, read-only, panel-scoped credentials.
 *
 * The product: a customer embeds ONE live Plexus panel in their own
 * app for THEIR customers, with no Plexus login. Their backend calls
 * POST /api/embed/token (server-to-server, authed by their `plx_` key) to mint
 * one of these; the browser then hands it to the panel's data/WS reads.
 *
 * A token is scoped to exactly {org, dashboard, panel} and carries a read-only
 * scope claim. It is NOT an API key: it cannot ingest, cannot read other panels,
 * and expires quickly (default 15m, capped 1h) so a leaked token is near-useless.
 * HS256 over AUTH_SECRET, mirroring lib/auth/ws-token.ts.
 *
 * Chunk 1 covers mint + verify + authorize. The data route that consumes a token
 * (chunk 3) calls `authorizeEmbedRead()` to bind the token to the exact panel the
 * browser is requesting.
 */

import "server-only";

import { SignJWT, jwtVerify } from "jose";

const EMBED_TOKEN_ISSUER = "plexus-embed";
const EMBED_SCOPE = "embed:read";

const DEFAULT_TTL_SECONDS = 15 * 60; // 15 minutes
const MIN_TTL_SECONDS = 60; // 1 minute floor
const MAX_TTL_SECONDS = 60 * 60; // 1 hour cap — a leaked token can't linger

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export interface EmbedTokenClaims {
  orgId: string;
  dashboardId: string;
  panelId: string;
}

/** Clamp a requested TTL into [MIN, MAX]; default when absent/invalid. */
export function clampTtl(requested?: number): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return DEFAULT_TTL_SECONDS;
  }
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.floor(requested)));
}

export async function mintEmbedToken(
  claims: EmbedTokenClaims,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<{ token: string; expiresAt: string; expiresIn: number }> {
  const ttl = clampTtl(ttlSeconds);
  const token = await new SignJWT({
    org_id: claims.orgId,
    dashboard_id: claims.dashboardId,
    panel_id: claims.panelId,
    scope: EMBED_SCOPE,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.panelId) // the resource this token speaks for
    .setIssuer(EMBED_TOKEN_ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secretKey());
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  return { token, expiresAt, expiresIn: ttl };
}

/**
 * Verify signature + issuer + scope + expiry and return the scoped claims, or
 * null on any failure (bad signature, wrong issuer, wrong/missing scope,
 * expired, malformed). Never throws.
 */
export async function verifyEmbedToken(
  token: string,
): Promise<EmbedTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: EMBED_TOKEN_ISSUER,
    });
    if (payload.scope !== EMBED_SCOPE) return null;
    const { org_id: orgId, dashboard_id: dashboardId, panel_id: panelId } =
      payload as Record<string, unknown>;
    if (
      typeof orgId !== "string" ||
      typeof dashboardId !== "string" ||
      typeof panelId !== "string"
    ) {
      return null;
    }
    return { orgId, dashboardId, panelId };
  } catch {
    return null;
  }
}

/**
 * Authorize a browser read: the token must be valid AND target EXACTLY the
 * dashboard+panel being requested. Returns the scoped claims (org_id for the
 * datastore filter) or null to deny. This is the single chokepoint chunk 3's
 * data route calls — a token for panel A can never read panel B.
 */
export async function authorizeEmbedRead(
  token: string,
  requested: { dashboardId: string; panelId: string },
): Promise<EmbedTokenClaims | null> {
  const claims = await verifyEmbedToken(token);
  if (!claims) return null;
  if (claims.dashboardId !== requested.dashboardId) return null;
  if (claims.panelId !== requested.panelId) return null;
  return claims;
}
