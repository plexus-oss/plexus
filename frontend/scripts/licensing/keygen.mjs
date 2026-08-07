#!/usr/bin/env node
/**
 * One-time Ed25519 keypair generation for license signing.
 *
 * Writes private.pem + public.pem to ~/.plexus/license-signing/ (OUTSIDE every
 * repo — the private key must never be committed anywhere). Refuses to
 * overwrite an existing key. After rotating, paste the printed public key into
 * lib/licensing/token.ts (LICENSE_PUBLIC_KEY_PEM) — old keys stop validating.
 */
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = join(homedir(), ".plexus/license-signing");
const privPath = join(dir, "private.pem");
const pubPath = join(dir, "public.pem");

if (existsSync(privPath)) {
  console.error(`refusing to overwrite existing key at ${privPath}`);
  console.error("(delete it manually first if you truly mean to rotate)");
  console.log(readFileSync(pubPath, "utf8"));
  process.exit(1);
}

mkdirSync(dir, { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }));

console.error(`private key: ${privPath} (mode 600 — back it up somewhere safe, NOT a repo)`);
console.error(`public key (embed in lib/licensing/token.ts):`);
console.log(readFileSync(pubPath, "utf8"));
