#!/usr/bin/env node
/**
 * Issue a Plexus enterprise license key (offline, Ed25519).
 *
 *   node scripts/licensing/sign-license.mjs \
 *     --org "Acme Aerospace" \
 *     --features sso,rbac,audit_logs \
 *     --expires 2027-08-07 \
 *     [--limits tenants=25] [--key ~/.plexus/license-signing/private.pem]
 *
 * Prints the token to stdout. The private key must NEVER be committed to any
 * repo; the default path is outside every repo on purpose. Generate a keypair
 * once with keygen.mjs.
 */
import { readFileSync } from "node:fs";
import { createPrivateKey, sign as edSign } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const KNOWN_FEATURES = [
  "sso",
  "rbac",
  "audit_logs",
  "multi_tenancy",
  "airgap_releases",
  "support",
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const org = arg("org");
const features = (arg("features", "") || "").split(",").filter(Boolean);
const expires = arg("expires");
const keyPath = arg("key", join(homedir(), ".plexus/license-signing/private.pem"));
const limitsArg = arg("limits", "");

if (!org || !expires || features.length === 0) {
  console.error(
    "usage: sign-license.mjs --org <name> --features sso,rbac,... --expires YYYY-MM-DD [--limits k=v,...] [--key path]",
  );
  process.exit(1);
}

const unknown = features.filter((f) => !KNOWN_FEATURES.includes(f));
if (unknown.length) {
  console.error(`unknown features: ${unknown.join(", ")} (known: ${KNOWN_FEATURES.join(", ")})`);
  process.exit(1);
}
const expMs = Date.parse(expires);
if (Number.isNaN(expMs)) {
  console.error(`--expires is not a date: ${expires}`);
  process.exit(1);
}
if (expMs <= Date.now()) {
  console.error(`--expires ${expires} is in the past — refusing to issue a dead key`);
  process.exit(1);
}

const limits = {};
for (const pair of limitsArg.split(",").filter(Boolean)) {
  const [k, v] = pair.split("=");
  const n = Number(v);
  if (!k || Number.isNaN(n)) {
    console.error(`bad --limits entry: ${pair} (expected key=number)`);
    process.exit(1);
  }
  limits[k] = n;
}

const payload = {
  v: 1,
  org,
  tier: "enterprise",
  features,
  iat: new Date().toISOString(),
  exp: new Date(expMs).toISOString(),
  ...(Object.keys(limits).length ? { limits } : {}),
};

let privateKey;
try {
  privateKey = createPrivateKey(readFileSync(keyPath));
} catch (err) {
  console.error(`cannot read private key at ${keyPath}: ${err.message}`);
  console.error("generate one with: node scripts/licensing/keygen.mjs");
  process.exit(1);
}

const bytes = Buffer.from(JSON.stringify(payload));
const sig = edSign(null, bytes, privateKey);
const token = `PLXL1.${bytes.toString("base64url")}.${sig.toString("base64url")}`;

console.error(`issued to: ${org}`);
console.error(`features:  ${features.join(", ")}`);
console.error(`expires:   ${payload.exp}`);
if (Object.keys(limits).length) console.error(`limits:    ${JSON.stringify(limits)}`);
console.error("");
console.log(token);
