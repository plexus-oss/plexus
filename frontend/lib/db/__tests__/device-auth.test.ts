import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { deviceAuthRequests } from "../schema";
import {
  adminDeviceAuthQueries,
  isClaimExpired,
} from "../queries/device-auth";

const ORG = "org-claim-test";

async function expireClaim(deviceCode: string): Promise<void> {
  await db
    .update(deviceAuthRequests)
    .set({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .where(eq(deviceAuthRequests.device_code, deviceCode));
}

describe("adminDeviceAuthQueries", () => {
  it("creates a pending claim with a human-safe user code and future expiry", async () => {
    const row = await adminDeviceAuthQueries.create("my-next-app");

    expect(row.status).toBe("pending");
    expect(row.requested_name).toBe("my-next-app");
    expect(row.device_code).toMatch(/^[0-9a-f]{64}$/);
    // 4+4 chars from the unambiguous alphabet, dash-separated
    expect(row.user_code).toMatch(/^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
    expect(isClaimExpired(row)).toBe(false);
  });

  it("approves only pending, unexpired claims and stamps the org", async () => {
    const row = await adminDeviceAuthQueries.create(null);

    const approved = await adminDeviceAuthQueries.approve(row.user_code, ORG);
    expect(approved?.status).toBe("approved");
    expect(approved?.org_id).toBe(ORG);

    // Second approval attempt hits a non-pending row → no-op
    const again = await adminDeviceAuthQueries.approve(row.user_code, "org-b");
    expect(again).toBeUndefined();
  });

  it("does not approve an expired claim", async () => {
    const row = await adminDeviceAuthQueries.create(null);
    await expireClaim(row.device_code);

    const approved = await adminDeviceAuthQueries.approve(row.user_code, ORG);
    expect(approved).toBeUndefined();
  });

  it("denies only pending claims", async () => {
    const row = await adminDeviceAuthQueries.create(null);

    const denied = await adminDeviceAuthQueries.deny(row.user_code);
    expect(denied?.status).toBe("denied");

    const approveAfterDeny = await adminDeviceAuthQueries.approve(
      row.user_code,
      ORG,
    );
    expect(approveAfterDeny).toBeUndefined();
  });

  it("delivers an approved claim exactly once", async () => {
    const row = await adminDeviceAuthQueries.create(null);
    await adminDeviceAuthQueries.approve(row.user_code, ORG);

    const first = await adminDeviceAuthQueries.claimDelivery(row.device_code);
    expect(first?.org_id).toBe(ORG);

    // The row is burned (status=expired) — a concurrent/second poll gets nothing
    const second = await adminDeviceAuthQueries.claimDelivery(row.device_code);
    expect(second).toBeUndefined();
  });

  it("does not deliver a pending or expired claim", async () => {
    const pending = await adminDeviceAuthQueries.create(null);
    expect(
      await adminDeviceAuthQueries.claimDelivery(pending.device_code),
    ).toBeUndefined();

    const stale = await adminDeviceAuthQueries.create(null);
    await adminDeviceAuthQueries.approve(stale.user_code, ORG);
    await expireClaim(stale.device_code);
    expect(
      await adminDeviceAuthQueries.claimDelivery(stale.device_code),
    ).toBeUndefined();
  });
});
