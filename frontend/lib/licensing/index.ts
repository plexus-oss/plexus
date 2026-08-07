/**
 * Entitlements — the single API every enterprise gate calls into.
 *
 *   import { entitled, FEATURE_SSO } from "@/lib/licensing";
 *   if (!entitled(FEATURE_SSO)) return upsell();
 *
 * Behavior contract (do not weaken):
 *   - No key           → free tier, silently. No nags, no banners; the only
 *                        user-visible surface is one line in settings.
 *   - Invalid key      → treated as no key (logged once, never crashes).
 *   - Expired key      → grace: previously-licensed features degrade to
 *                        READ-ONLY with a clear message + renewal link.
 *                        Never crash, never delete data, never lock anyone
 *                        out of their own telemetry.
 *   - Verification is fully offline (see token.ts).
 *
 * "Read-only" is enforced at call sites: gate mutations with `entitled()`
 * (full access only) and reads with `accessLevel() !== "none"`.
 */
import "server-only";
import { readFileSync, statSync } from "node:fs";
import {
  ENTERPRISE_FEATURES,
  type EnterpriseFeature,
} from "./registry";
import { parseLicenseToken, type LicensePayload } from "./token";

export * from "./registry";
export { parseLicenseToken, TOKEN_PREFIX, type LicensePayload } from "./token";

// Points at pricing until a dedicated /renew page exists on marketing.
export const RENEWAL_URL = "https://plexus.company/pricing";

export type AccessLevel = "full" | "readonly" | "none";

export interface LicenseStatus {
  tier: "free" | "enterprise";
  /** Present only when a valid (possibly expired) key is installed. */
  org?: string;
  features: EnterpriseFeature[];
  expiresAt?: string;
  expired: boolean;
  limits?: Record<string, number>;
  /** One-line, settings-page-ready description of the current state. */
  message: string;
  /** Present only when action is needed (expired). */
  renewalUrl?: string;
}

interface ResolvedLicense {
  payload: LicensePayload | null;
  /** Cache key: env value + file mtime, so key rotation is picked up live. */
  cacheKey: string;
}

let cached: ResolvedLicense | null = null;
let warnedInvalid = false;

function currentCacheKey(): string {
  const envToken = process.env.PLEXUS_LICENSE ?? "";
  const filePath = process.env.PLEXUS_LICENSE_FILE ?? "";
  let fileStamp = "";
  if (filePath) {
    try {
      fileStamp = String(statSync(filePath).mtimeMs);
    } catch {
      fileStamp = "missing";
    }
  }
  return `${envToken}|${filePath}|${fileStamp}`;
}

function resolveLicense(): LicensePayload | null {
  const cacheKey = currentCacheKey();
  if (cached && cached.cacheKey === cacheKey) return cached.payload;

  let token = process.env.PLEXUS_LICENSE?.trim() ?? "";
  if (!token && process.env.PLEXUS_LICENSE_FILE) {
    try {
      token = readFileSync(process.env.PLEXUS_LICENSE_FILE, "utf8").trim();
    } catch {
      token = "";
    }
  }

  let payload: LicensePayload | null = null;
  if (token) {
    const result = parseLicenseToken(token);
    if (result.ok) {
      payload = result.payload;
    } else if (!warnedInvalid) {
      // Invalid ≠ crash and ≠ nag: log once, run as free tier.
      console.warn(`[licensing] license key ignored (${result.reason}); running as free tier`);
      warnedInvalid = true;
    }
  }

  cached = { payload, cacheKey };
  return payload;
}

function isExpired(payload: LicensePayload): boolean {
  return Date.parse(payload.exp) <= Date.now();
}

function licensedFeatures(payload: LicensePayload): EnterpriseFeature[] {
  // Unknown keys in the token are ignored (newer license, older build).
  return payload.features.filter(
    (f): f is EnterpriseFeature => f in ENTERPRISE_FEATURES,
  );
}

/**
 * Access level for a gated feature.
 * `full` = licensed and current · `readonly` = licensed but key expired
 * (grace) · `none` = not licensed (free tier).
 */
export function accessLevel(feature: EnterpriseFeature): AccessLevel {
  const payload = resolveLicense();
  if (!payload || !licensedFeatures(payload).includes(feature)) return "none";
  return isExpired(payload) ? "readonly" : "full";
}

/** True only for full (current, licensed) access. Gate all mutations on this. */
export function entitled(feature: EnterpriseFeature): boolean {
  return accessLevel(feature) === "full";
}

/** Numeric limit from the key, if the license carries one for `name`. */
export function licenseLimit(name: string): number | undefined {
  return resolveLicense()?.limits?.[name];
}

export function licenseStatus(): LicenseStatus {
  const payload = resolveLicense();
  if (!payload) {
    return {
      tier: "free",
      features: [],
      expired: false,
      message: "Free tier — no license key installed.",
    };
  }
  const features = licensedFeatures(payload);
  const expired = isExpired(payload);
  return {
    tier: "enterprise",
    org: payload.org,
    features,
    expiresAt: payload.exp,
    expired,
    limits: payload.limits,
    message: expired
      ? `Enterprise license for ${payload.org} expired ${payload.exp.slice(0, 10)} — enterprise features are read-only until renewed.`
      : `Enterprise license for ${payload.org}, valid until ${payload.exp.slice(0, 10)}.`,
    ...(expired ? { renewalUrl: RENEWAL_URL } : {}),
  };
}

/** Test-only: drop the cache so env changes take effect. */
export function __resetLicenseCache(): void {
  cached = null;
  warnedInvalid = false;
}
