/**
 * Admin (no-RLS) queries for the coding-agent key-claim flow
 * (device_auth_requests). The requesting agent is anonymous until a
 * signed-in admin approves the claim, so these run on the admin pool —
 * the routes are responsible for gating.
 *
 * Lifecycle: pending → approved (by a signed-in admin) → expired (key
 * delivered exactly once at poll time), or pending → denied. Rows past
 * expires_at are treated as expired regardless of status.
 */

import "server-only";

import { randomBytes } from "crypto";
import { and, eq, gt } from "drizzle-orm";

import { db } from "../client";
import { deviceAuthRequests } from "../schema";

export const CLAIM_TTL_SECONDS = 15 * 60;

// No ambiguous glyphs (0/O, 1/I/L) — the code is read by a human off a terminal.
const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateUserCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export type DeviceAuthRequest = typeof deviceAuthRequests.$inferSelect;

export function isClaimExpired(row: DeviceAuthRequest): boolean {
  return new Date(row.expires_at) < new Date();
}

export const adminDeviceAuthQueries = {
  create: async (requestedName: string | null): Promise<DeviceAuthRequest> => {
    const device_code = randomBytes(32).toString("hex");
    const expires_at = new Date(
      Date.now() + CLAIM_TTL_SECONDS * 1000,
    ).toISOString();

    // user_code is unique-indexed; retry the (unlikely) collision.
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const rows = await db
          .insert(deviceAuthRequests)
          .values({
            device_code,
            user_code: generateUserCode(),
            expires_at,
            requested_name: requestedName,
          })
          .returning();
        return rows[0];
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  },

  findByDeviceCode: async (
    deviceCode: string,
  ): Promise<DeviceAuthRequest | undefined> => {
    const rows = await db
      .select()
      .from(deviceAuthRequests)
      .where(eq(deviceAuthRequests.device_code, deviceCode));
    return rows[0];
  },

  findByUserCode: async (
    userCode: string,
  ): Promise<DeviceAuthRequest | undefined> => {
    const rows = await db
      .select()
      .from(deviceAuthRequests)
      .where(eq(deviceAuthRequests.user_code, userCode));
    return rows[0];
  },

  /** Approve a pending, unexpired claim and stamp the approver's org. */
  approve: async (
    userCode: string,
    orgId: string,
  ): Promise<DeviceAuthRequest | undefined> => {
    const rows = await db
      .update(deviceAuthRequests)
      .set({ status: "approved", org_id: orgId })
      .where(
        and(
          eq(deviceAuthRequests.user_code, userCode),
          eq(deviceAuthRequests.status, "pending"),
          gt(deviceAuthRequests.expires_at, new Date().toISOString()),
        ),
      )
      .returning();
    return rows[0];
  },

  deny: async (userCode: string): Promise<DeviceAuthRequest | undefined> => {
    const rows = await db
      .update(deviceAuthRequests)
      .set({ status: "denied" })
      .where(
        and(
          eq(deviceAuthRequests.user_code, userCode),
          eq(deviceAuthRequests.status, "pending"),
        ),
      )
      .returning();
    return rows[0];
  },

  /**
   * Atomically flip approved → expired so the key is minted and delivered to
   * exactly one poll, even under concurrent polling. Returns the row only to
   * the winner.
   */
  claimDelivery: async (
    deviceCode: string,
  ): Promise<DeviceAuthRequest | undefined> => {
    const rows = await db
      .update(deviceAuthRequests)
      .set({ status: "expired" })
      .where(
        and(
          eq(deviceAuthRequests.device_code, deviceCode),
          eq(deviceAuthRequests.status, "approved"),
          gt(deviceAuthRequests.expires_at, new Date().toISOString()),
        ),
      )
      .returning();
    return rows[0];
  },

  attachApiKey: async (deviceCode: string, apiKeyId: string): Promise<void> => {
    await db
      .update(deviceAuthRequests)
      .set({ api_key_id: apiKeyId })
      .where(eq(deviceAuthRequests.device_code, deviceCode));
  },
};
