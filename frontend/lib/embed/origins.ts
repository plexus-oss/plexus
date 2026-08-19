/**
 * Embed origins — which browser origins an org may render embedded panels from,
 * proven by DNS domain ownership (Vercel/Resend style).
 *
 * Flow: the org adds an origin (https://app.example.com) in Settings → we store
 * it unverified with a random token and show them a TXT record to publish →
 * they publish it and hit Verify → we resolve the TXT and match the token →
 * verified. Only VERIFIED origins authorize CORS on the embed data plane.
 *
 * This module is pure logic (parsing, record shape, matching) + a thin DNS
 * lookup that takes an injectable resolver so ownership verification is unit-
 * testable without real DNS.
 */

import "server-only";

import { randomBytes } from "node:crypto";
import { resolveTxt as dnsResolveTxt } from "node:dns/promises";

/** The DNS label we look for the verification TXT under. */
const VERIFY_PREFIX = "_plexus-verify";
const TXT_VALUE_PREFIX = "plexus-verify=";

/**
 * Normalize a user-entered origin to the exact string a browser sends in the
 * `Origin` header: `scheme://host[:port]`, lowercased host, no path/query/hash,
 * default ports dropped. Returns null for anything that isn't a valid http(s)
 * origin. Exactness matters — CORS reflection compares against this verbatim.
 */
export function normalizeOrigin(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname) return null;
  // URL already lowercases the hostname and omits a default port. Reject any
  // path/search/hash so only a bare origin is stored.
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    return null;
  }
  return url.port
    ? `${url.protocol}//${url.hostname}:${url.port}`
    : `${url.protocol}//${url.hostname}`;
}

/** The hostname we verify ownership of (the origin's host). */
export function domainOf(origin: string): string | null {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return null;
  return new URL(normalized).hostname;
}

/** Cryptographically-random verification token (32 hex chars). */
export function generateVerificationToken(): string {
  return randomBytes(16).toString("hex");
}

/** The exact DNS record the customer must publish to prove ownership. */
export function verificationRecord(
  domain: string,
  token: string,
): { type: "TXT"; name: string; value: string } {
  return {
    type: "TXT",
    name: `${VERIFY_PREFIX}.${domain}`,
    value: `${TXT_VALUE_PREFIX}${token}`,
  };
}

export type TxtResolver = (hostname: string) => Promise<string[][]>;

/**
 * Verify domain ownership by resolving the `_plexus-verify.<domain>` TXT record
 * and matching the expected token. DNS TXT values can be split into chunks per
 * record, so each record's chunks are joined before comparing. Any lookup error
 * (NXDOMAIN, timeout) means "not verified", never throws.
 */
export async function verifyDomainOwnership(
  domain: string,
  expectedToken: string,
  resolver: TxtResolver = dnsResolveTxt,
): Promise<boolean> {
  if (!domain || !expectedToken) return false;
  const expected = `${TXT_VALUE_PREFIX}${expectedToken}`;
  let records: string[][];
  try {
    records = await resolver(`${VERIFY_PREFIX}.${domain}`);
  } catch {
    return false;
  }
  return records.some((chunks) => chunks.join("").trim() === expected);
}

/**
 * Resolve the CORS `Access-Control-Allow-Origin` value for a request: return the
 * request's origin iff it exactly matches one of the org's verified origins,
 * else null (→ no ACAO header → the browser blocks the cross-site read). The
 * caller passes only VERIFIED origins.
 */
export function resolveAllowedOrigin(
  requestOrigin: string | null,
  verifiedOrigins: string[],
): string | null {
  if (!requestOrigin) return null;
  const normalized = normalizeOrigin(requestOrigin);
  if (!normalized) return null;
  return verifiedOrigins.includes(normalized) ? normalized : null;
}

/**
 * CORS headers for an embed data response. When `allowedOrigin` is non-null the
 * origin was verified for this org and gets reflected; `Vary: Origin` keeps
 * caches from crossing origins. When null, no ACAO is emitted and the browser
 * refuses the cross-site read.
 */
export function embedCorsHeaders(allowedOrigin: string | null): HeadersInit {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "content-type, x-embed-token";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}
