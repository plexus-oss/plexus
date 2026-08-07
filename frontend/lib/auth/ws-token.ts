/**
 * Short-lived signed tokens for the gateway WebSocket handshake.
 *
 * The browser hands the gateway a bearer token; the gateway calls back to
 * GET /api/auth/verify-session to resolve it to { org_id, user_id }.
 * Auth.js DB sessions have no JWT to hand over, so /api/auth/ws-token
 * mints one of these: HS256 over AUTH_SECRET, 5-minute TTL — long enough
 * to open the socket (the gateway verifies once at handshake), short
 * enough that a leaked token is near-useless.
 */

import "server-only";

import { SignJWT, jwtVerify } from "jose";

const WS_TOKEN_TTL_SECONDS = 5 * 60;
const WS_TOKEN_ISSUER = "plexus-ws";

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function mintWsToken(args: {
  userId: string;
  orgId: string;
}): Promise<string> {
  return new SignJWT({ org_id: args.orgId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(args.userId)
    .setIssuer(WS_TOKEN_ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${WS_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyWsToken(
  token: string,
): Promise<{ userId: string; orgId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: WS_TOKEN_ISSUER,
    });
    const userId = payload.sub;
    const orgId = payload.org_id;
    if (typeof userId !== "string" || typeof orgId !== "string") return null;
    return { userId, orgId };
  } catch {
    return null;
  }
}
