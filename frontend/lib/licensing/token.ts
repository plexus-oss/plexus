/**
 * License token format + offline verification.
 *
 * Token: `PLXL1.<base64url(payload JSON)>.<base64url(Ed25519 signature)>`
 * The signature covers the exact payload bytes. Verification is FULLY OFFLINE
 * — no network call, ever. Buyers run air-gapped and ITAR-restricted networks;
 * a phone-home would break the exact market this product sells to.
 *
 * The public key is embedded below; the private key lives outside every repo
 * (see scripts/licensing/README.md).
 */
import { createPublicKey, verify as edVerify } from "node:crypto";

/** Ed25519 public verification key (SPKI). Safe to embed — it can only verify. */
const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEALyZXVPhw/6+q5fOQKdTbsf1vvLOZ2RFR09DeARuJmho=
-----END PUBLIC KEY-----`;

export const TOKEN_PREFIX = "PLXL1";

export interface LicensePayload {
  v: 1;
  /** Org name the license was issued to (display + audit, not enforcement). */
  org: string;
  tier: "enterprise";
  /** Feature keys from the registry. Unknown keys are ignored (forward compat). */
  features: string[];
  /** ISO-8601 issue date. */
  iat: string;
  /** ISO-8601 expiry. */
  exp: string;
  /** Optional numeric limits (e.g. { tenants: 25 }). Enforcement is per-feature. */
  limits?: Record<string, number>;
}

export type ParseResult =
  | { ok: true; payload: LicensePayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "bad_payload" };

function b64urlDecode(part: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) return null;
  try {
    return Buffer.from(part, "base64url");
  } catch {
    return null;
  }
}

function isValidPayload(value: unknown): value is LicensePayload {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    p.v === 1 &&
    typeof p.org === "string" &&
    p.org.length > 0 &&
    p.tier === "enterprise" &&
    Array.isArray(p.features) &&
    p.features.every((f) => typeof f === "string") &&
    typeof p.iat === "string" &&
    !Number.isNaN(Date.parse(p.iat)) &&
    typeof p.exp === "string" &&
    !Number.isNaN(Date.parse(p.exp)) &&
    (p.limits === undefined ||
      (typeof p.limits === "object" &&
        p.limits !== null &&
        Object.values(p.limits).every((n) => typeof n === "number")))
  );
}

/**
 * Parse + verify a token. Never throws — a bad key must never crash the
 * platform; callers treat any failure as "no license" (free tier).
 */
export function parseLicenseToken(token: string): ParseResult {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    return { ok: false, reason: "malformed" };
  }
  const payloadBytes = b64urlDecode(parts[1]);
  const sigBytes = b64urlDecode(parts[2]);
  if (!payloadBytes || !sigBytes) return { ok: false, reason: "malformed" };

  let signatureOk = false;
  try {
    signatureOk = edVerify(
      null,
      payloadBytes,
      createPublicKey(LICENSE_PUBLIC_KEY_PEM),
      sigBytes,
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { ok: false, reason: "bad_signature" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "bad_payload" };
  }
  if (!isValidPayload(parsed)) return { ok: false, reason: "bad_payload" };
  return { ok: true, payload: parsed };
}
