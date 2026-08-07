/**
 * API Key Authentication
 *
 * API Keys (plx_*) are created by users for scripts/integrations and device auth.
 *
 * API Key format: plx_[32 random chars]
 */

import "server-only";

import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { adminApiKeyQueries } from "@/lib/db/server";

// =============================================================================
// CONSTANTS
// =============================================================================

const API_KEY_PREFIX = "plx_";
const API_KEY_LENGTH = 32;

// Dev API key for internal telemetry (development only)
const DEV_API_KEY = "plx_dev_internal_telemetry_key";
const DEV_ORG_ID = "dev_internal_org";

// =============================================================================
// TYPES
// =============================================================================

export interface ApiKeyInfo {
  id: string;
  org_id: string;
  name: string;
  key_prefix: string;
  active: boolean;
  scopes: string[];
  last_used_at: string | null;
  request_count: number;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface GeneratedApiKey {
  /** The full API key - only shown once at creation */
  key: string;
  /** First 8 characters for identification */
  prefix: string;
  /** SHA-256 hash for storage */
  hash: string;
}

export interface AuthResult {
  success: true;
  orgId: string;
  authMethod: "api_key" | "session";
  keyId?: string;
  userId?: string;
  scopes?: string[];  // Present when authenticated via API key
}

export interface AuthError {
  success: false;
  error: string;
  status: number;
}

// =============================================================================
// KEY GENERATION & HASHING
// =============================================================================

/**
 * Generate a new API key
 */
export function generateApiKey(): GeneratedApiKey {
  let randomPart = "";
  while (randomPart.length < API_KEY_LENGTH) {
    randomPart += randomBytes(32).toString("base64").replace(/[+/=]/g, "");
  }
  randomPart = randomPart.substring(0, API_KEY_LENGTH);

  const key = `${API_KEY_PREFIX}${randomPart}`;
  const prefix = key.substring(0, 12);
  const hash = hashApiKey(key);

  return { key, prefix, hash };
}

/**
 * Hash an API key for secure storage
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Validate API key format
 */
export function isValidApiKeyFormat(key: string): boolean {
  if (!key || typeof key !== "string") return false;
  if (!key.startsWith(API_KEY_PREFIX)) return false;
  if (key.length !== API_KEY_PREFIX.length + API_KEY_LENGTH) return false;
  return true;
}

// =============================================================================
// AUTHENTICATION
// =============================================================================

/**
 * Authenticate a request using API key or the user session
 *
 * Checks in order:
 * 1. x-api-key header (plx_* API keys)
 * 2. User session (getAuth)
 */
export async function authenticateRequest(
  request: NextRequest
): Promise<AuthResult | AuthError> {
  const apiKeyHeader = request.headers.get("x-api-key");

  if (apiKeyHeader) {
    return authenticateWithApiKey(apiKeyHeader);
  }

  // Fall back to the user session
  return authenticateWithSession();
}

async function authenticateWithApiKey(
  apiKey: string
): Promise<AuthResult | AuthError> {
  // Check for dev API key in development mode
  if (process.env.NODE_ENV === "development" && apiKey === DEV_API_KEY) {
    return {
      success: true,
      orgId: DEV_ORG_ID,
      authMethod: "api_key",
      keyId: "dev_internal",
    };
  }

  if (!isValidApiKeyFormat(apiKey)) {
    return {
      success: false,
      error: "Invalid API key format",
      status: 401,
    };
  }

  const keyHash = hashApiKey(apiKey);
  const keyRecords = await adminApiKeyQueries.findByHash(keyHash);
  const keyRecord = keyRecords?.[0] as {
    id: string;
    org_id: string;
    expires_at: string | null;
    scopes: string[] | null;
  } | undefined;

  if (!keyRecord) {
    return {
      success: false,
      error: "Invalid API key",
      status: 401,
    };
  }

  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    return {
      success: false,
      error: "API key has expired",
      status: 401,
    };
  }

  const scopes = keyRecord.scopes ?? [];

  adminApiKeyQueries.updateLastUsed(keyRecord.id).catch(() => {});

  return {
    success: true,
    orgId: keyRecord.org_id,
    authMethod: "api_key",
    keyId: keyRecord.id,
    scopes,
  };
}

/**
 * Check if an auth result has the required scope.
 * User sessions implicitly have all scopes.
 * API keys must explicitly have the scope or the wildcard "*".
 */
export function hasScope(authResult: AuthResult, scope: string): boolean {
  if (authResult.authMethod === "session") {
    return true;
  }

  // API keys must have the scope explicitly
  const scopes = authResult.scopes ?? [];
  return scopes.includes(scope) || scopes.includes("*");
}

/**
 * Return a 403 response if the auth result lacks the required scope.
 */
export function requireScope(
  authResult: AuthResult,
  scope: string
): NextResponse | null {
  if (hasScope(authResult, scope)) {
    return null;
  }
  return NextResponse.json(
    { error: `API key does not have required scope: ${scope}` },
    { status: 403 }
  );
}

async function authenticateWithSession(): Promise<AuthResult | AuthError> {
  try {
    const { userId, orgId } = await getAuth();

    if (!userId) {
      return {
        success: false,
        error: "Authentication required. Provide x-api-key header or sign in.",
        status: 401,
      };
    }

    if (!orgId) {
      return {
        success: false,
        error: "Organization context required",
        status: 400,
      };
    }

    return {
      success: true,
      orgId,
      authMethod: "session",
      userId,
    };
  } catch {
    return {
      success: false,
      error: "Authentication failed",
      status: 401,
    };
  }
}

/**
 * Create an error response from an auth error
 */
export function authErrorResponse(error: AuthError): NextResponse {
  return NextResponse.json({ error: error.error }, { status: error.status });
}
