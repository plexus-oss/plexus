import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import {
  entitled,
  accessLevel,
  licenseStatus,
  licenseLimit,
  __resetLicenseCache,
  FEATURE_SSO,
  FEATURE_RBAC,
  FEATURE_AUDIT_LOGS,
} from "@/lib/licensing";
import { parseLicenseToken, TOKEN_PREFIX } from "@/lib/licensing/token";

// The real private key never lives in the repo, so tests sign with a
// throwaway keypair for negative cases and use payload tampering to prove
// the embedded public key rejects anything we didn't sign.
const strangerKeys = generateKeyPairSync("ed25519");

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function forgeToken(payload: object): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  const sig = edSign(null, bytes, strangerKeys.privateKey);
  return `${TOKEN_PREFIX}.${b64url(bytes)}.${b64url(sig)}`;
}

const FUTURE = new Date(Date.now() + 365 * 864e5).toISOString();
const PAST = new Date(Date.now() - 864e5).toISOString();

function payload(overrides: object = {}) {
  return {
    v: 1,
    org: "Test Org",
    tier: "enterprise",
    features: ["sso", "rbac"],
    iat: new Date().toISOString(),
    exp: FUTURE,
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.PLEXUS_LICENSE;
  delete process.env.PLEXUS_LICENSE_FILE;
  __resetLicenseCache();
});

afterAll(() => {
  delete process.env.PLEXUS_LICENSE;
  __resetLicenseCache();
});

describe("no key (free tier, silent)", () => {
  it("reports free tier and denies enterprise features", () => {
    expect(licenseStatus().tier).toBe("free");
    expect(entitled(FEATURE_SSO)).toBe(false);
    expect(accessLevel(FEATURE_RBAC)).toBe("none");
  });
});

describe("token verification (offline, embedded key)", () => {
  it("rejects a token signed by a different keypair", () => {
    const result = parseLicenseToken(forgeToken(payload()));
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects malformed tokens without throwing", () => {
    for (const bad of ["", "PLXL1", "PLXL1.a", "nope.a.b", "PLXL1.!!.??", "PLXL1.a.b.c"]) {
      expect(parseLicenseToken(bad).ok).toBe(false);
    }
  });

  it("treats a forged key as free tier instead of crashing", () => {
    process.env.PLEXUS_LICENSE = forgeToken(payload());
    __resetLicenseCache();
    expect(licenseStatus().tier).toBe("free");
    expect(entitled(FEATURE_SSO)).toBe(false);
  });
});

// Positive-path tests use a token signed by the REAL private key if present
// on this machine (~/.plexus/license-signing/private.pem); skipped otherwise
// so CI without the key still passes.
import { readFileSync, existsSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const realKeyPath = join(homedir(), ".plexus/license-signing/private.pem");
const haveRealKey = existsSync(realKeyPath);

function signReal(p: object): string {
  const key = createPrivateKey(readFileSync(realKeyPath));
  const bytes = Buffer.from(JSON.stringify(p));
  return `${TOKEN_PREFIX}.${b64url(bytes)}.${b64url(edSign(null, bytes, key))}`;
}

describe.runIf(haveRealKey)("valid key (signed with real private key)", () => {
  it("grants full access to licensed features only", () => {
    process.env.PLEXUS_LICENSE = signReal(payload());
    __resetLicenseCache();
    expect(entitled(FEATURE_SSO)).toBe(true);
    expect(accessLevel(FEATURE_RBAC)).toBe("full");
    expect(entitled(FEATURE_AUDIT_LOGS)).toBe(false); // not in features list
    const status = licenseStatus();
    expect(status.tier).toBe("enterprise");
    expect(status.org).toBe("Test Org");
    expect(status.expired).toBe(false);
    expect(status.renewalUrl).toBeUndefined();
  });

  it("expired key degrades to read-only with renewal link, never 'none'", () => {
    process.env.PLEXUS_LICENSE = signReal(payload({ exp: PAST }));
    __resetLicenseCache();
    expect(entitled(FEATURE_SSO)).toBe(false); // mutations gated off
    expect(accessLevel(FEATURE_SSO)).toBe("readonly"); // reads stay open
    const status = licenseStatus();
    expect(status.expired).toBe(true);
    expect(status.renewalUrl).toBeTruthy();
    expect(status.message).toContain("read-only");
  });

  it("ignores unknown feature keys (newer license, older build)", () => {
    process.env.PLEXUS_LICENSE = signReal(
      payload({ features: ["sso", "quantum_teleport"] }),
    );
    __resetLicenseCache();
    expect(entitled(FEATURE_SSO)).toBe(true);
    expect(licenseStatus().features).toEqual(["sso"]);
  });

  it("exposes limits from the key", () => {
    process.env.PLEXUS_LICENSE = signReal(payload({ limits: { tenants: 25 } }));
    __resetLicenseCache();
    expect(licenseLimit("tenants")).toBe(25);
    expect(licenseLimit("nope")).toBeUndefined();
  });
});
