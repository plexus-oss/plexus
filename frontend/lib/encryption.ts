/**
 * Encryption utilities for securing sensitive data at rest.
 * Uses AES-256-GCM for authenticated encryption.
 *
 * NOTE: This module is server-only.
 */

import "server-only";

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM recommended IV length
const AUTH_TAG_LENGTH = 16;
const V2_PREFIX = "v2:";

// Key store: keyId -> Buffer
let _keyStore: Map<string, Buffer> | null = null;
let _currentKeyId: string | null = null;

/**
 * Parse ENCRYPTION_KEYS env var (comma-separated keyId:base64key pairs)
 * and ENCRYPTION_KEY_CURRENT for the active key.
 * Falls back to legacy ENCRYPTION_KEY for backward compatibility.
 */
function getKeyStore(): { keys: Map<string, Buffer>; currentKeyId: string } {
  if (_keyStore && _currentKeyId) {
    return { keys: _keyStore, currentKeyId: _currentKeyId };
  }

  const keysEnv = process.env.ENCRYPTION_KEYS;
  const currentId = process.env.ENCRYPTION_KEY_CURRENT;

  if (keysEnv && currentId) {
    const keys = new Map<string, Buffer>();
    for (const entry of keysEnv.split(",")) {
      const colonIdx = entry.indexOf(":");
      if (colonIdx === -1) continue;
      const id = entry.slice(0, colonIdx).trim();
      const b64 = entry.slice(colonIdx + 1).trim();
      const buf = Buffer.from(b64, "base64");
      if (buf.length !== 32) {
        throw new Error(
          `Encryption key "${id}" must be 32 bytes base64 encoded`,
        );
      }
      keys.set(id, buf);
    }

    if (!keys.has(currentId)) {
      throw new Error(
        `ENCRYPTION_KEY_CURRENT="${currentId}" not found in ENCRYPTION_KEYS`,
      );
    }

    _keyStore = keys;
    _currentKeyId = currentId;
    return { keys, currentKeyId: currentId };
  }

  // Fallback to legacy single key
  const legacyKey = getLegacyKey();
  const keys = new Map<string, Buffer>();
  keys.set("legacy", legacyKey);
  _keyStore = keys;
  _currentKeyId = "legacy";
  return { keys, currentKeyId: "legacy" };
}

function getLegacyKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is not set. " +
        "Generate one with: openssl rand -base64 32",
    );
  }

  const keyBuffer = Buffer.from(key, "base64");

  if (keyBuffer.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must be 32 bytes (256 bits) base64 encoded. " +
        "Generate one with: openssl rand -base64 32",
    );
  }

  return keyBuffer;
}

/**
 * Encrypts a string using AES-256-GCM.
 * Uses the current key and prefixes output with v2:{keyId}: for rotation support.
 */
export function encrypt(plaintext: string): string {
  const { keys, currentKeyId } = getKeyStore();
  const key = keys.get(currentKeyId)!;
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, encrypted, authTag]);

  // v2 format: v2:{keyId}:{base64 payload}
  return `${V2_PREFIX}${currentKeyId}:${combined.toString("base64")}`;
}

/**
 * Decrypts a string encrypted with encrypt().
 * Handles both v2 (key-rotated) and legacy (single-key) formats.
 */
export function decrypt(encryptedData: string): string {
  let key: Buffer;
  let payload: string;

  if (encryptedData.startsWith(V2_PREFIX)) {
    // v2:{keyId}:{base64}
    const rest = encryptedData.slice(V2_PREFIX.length);
    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) {
      throw new Error("Invalid v2 encrypted data format");
    }
    const keyId = rest.slice(0, colonIdx);
    payload = rest.slice(colonIdx + 1);

    const { keys } = getKeyStore();
    const found = keys.get(keyId);
    if (!found) {
      throw new Error(`Encryption key "${keyId}" not found — cannot decrypt`);
    }
    key = found;
  } else {
    // Legacy format — use legacy key
    key = getLegacyKey();
    payload = encryptedData;
  }

  const combined = Buffer.from(payload, "base64");

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(
    IV_LENGTH,
    combined.length - AUTH_TAG_LENGTH,
  );

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
