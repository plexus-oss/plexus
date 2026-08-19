import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// The route is session-authed via withRoleAuth; mock it to a pass-through that
// injects a fixed org + params so we test the verify logic, not the auth wrapper.
vi.mock("@/lib/api/with-auth", () => ({
  withRoleAuth: (_roles: string[], handler: unknown) => handler,
}));
vi.mock("@/lib/db/server", () => ({
  adminEmbedOriginQueries: {
    findById: vi.fn(),
    markVerified: vi.fn(),
  },
}));
vi.mock("@/lib/embed/origins", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/embed/origins")>();
  return { ...actual, verifyDomainOwnership: vi.fn() };
});

import { adminEmbedOriginQueries } from "@/lib/db/server";
import { verifyDomainOwnership } from "@/lib/embed/origins";
import { POST } from "@/app/api/embed/origins/[id]/verify/route";

const mockFindById = vi.mocked(adminEmbedOriginQueries.findById);
const mockMarkVerified = vi.mocked(adminEmbedOriginQueries.markVerified);
const mockVerify = vi.mocked(verifyDomainOwnership);

// The mocked withRoleAuth calls handler(request, ctx); build ctx ourselves.
function call(id: string, orgId = "org_test") {
  const ctx = { orgId, userId: "u1", orgRole: "org:admin", params: Promise.resolve({ id }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (POST as any)({} as NextRequest, ctx);
}

const unverifiedRow = {
  id: "o1",
  org_id: "org_test",
  origin: "https://app.example.com",
  domain: "app.example.com",
  verification_token: "tok",
  verified_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

it("404 when the origin isn't found for this org", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockFindById.mockResolvedValue(undefined as any);
  const res = await call("missing");
  expect(res.status).toBe(404);
  expect(mockFindById).toHaveBeenCalledWith("org_test", "missing");
});

it("marks verified when the DNS TXT matches", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockFindById.mockResolvedValue(unverifiedRow as any);
  mockVerify.mockResolvedValue(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockMarkVerified.mockResolvedValue({ verified_at: "2026-08-19T00:00:00Z" } as any);
  const res = await call("o1");
  const json = (await res.json()) as { verified: boolean };
  expect(res.status).toBe(200);
  expect(json.verified).toBe(true);
  expect(mockMarkVerified).toHaveBeenCalledWith("org_test", "o1");
});

it("422 with the record to publish when the TXT is absent", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockFindById.mockResolvedValue(unverifiedRow as any);
  mockVerify.mockResolvedValue(false);
  const res = await call("o1");
  const json = (await res.json()) as { verified: boolean; record: { name: string } };
  expect(res.status).toBe(422);
  expect(json.verified).toBe(false);
  expect(json.record.name).toBe("_plexus-verify.app.example.com");
  expect(mockMarkVerified).not.toHaveBeenCalled();
});

it("is idempotent for an already-verified origin (no DNS lookup)", async () => {
  mockFindById.mockResolvedValue({
    ...unverifiedRow,
    verified_at: "2026-08-01T00:00:00Z",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  const res = await call("o1");
  expect(res.status).toBe(200);
  expect(mockVerify).not.toHaveBeenCalled();
});

describe("smoke", () => {
  it("exports POST", () => expect(typeof POST).toBe("function"));
});
