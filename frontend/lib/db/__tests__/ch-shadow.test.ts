import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyRead, withShadowAudit } from "@/lib/db/ch-shadow";

// classifyRead is pure and always available; the proxy is gated by the env flag,
// so proxy tests set it explicitly.

describe("classifyRead", () => {
  it("flags an unscoped tenant read as RISK (would blank under policy)", () => {
    const v = classifyRead("SELECT * FROM telemetry WHERE metric = 'x'", "unscoped");
    expect(v.risk).toBe(true);
    expect(v.tenantTable).toBe("telemetry");
  });

  it("flags unscoped reads of every tenant table + _dist variant", () => {
    for (const t of [
      "telemetry_dist",
      "telemetry_1min",
      "telemetry_1hr_dist",
      "events",
      "events_dist",
      "video_sessions",
    ]) {
      const v = classifyRead(`SELECT count() FROM ${t}`, "unscoped");
      expect(v.risk, t).toBe(true);
    }
  });

  it("clears org-scoped tenant reads (setting stamped → policy passes)", () => {
    const v = classifyRead("SELECT * FROM telemetry_dist", "org-scoped");
    expect(v.risk).toBe(false);
    expect(v.reason).toBe("scoped");
  });

  it("clears global tenant reads (nextjs_global bypasses the policy)", () => {
    const v = classifyRead("SELECT org_id, count() FROM telemetry GROUP BY org_id", "global");
    expect(v.risk).toBe(false);
  });

  it("ignores non-tenant reads even when unscoped (system/DDL)", () => {
    expect(classifyRead("SELECT * FROM system.parts", "unscoped").risk).toBe(false);
    expect(classifyRead("DESCRIBE TABLE telemetry", "unscoped").risk).toBe(false);
    expect(classifyRead("SELECT 1", "unscoped").risk).toBe(false);
  });

  it("does not flag a WITH-CTE tenant read as a non-read", () => {
    const v = classifyRead("WITH x AS (SELECT 1) SELECT * FROM events", "unscoped");
    expect(v.risk).toBe(true);
  });
});

describe("withShadowAudit proxy", () => {
  const OLD = process.env.PLEXUS_CH_ROW_POLICY_SHADOW;
  beforeEach(() => {
    process.env.PLEXUS_CH_ROW_POLICY_SHADOW = "1";
    vi.restoreAllMocks();
  });
  afterEach(() => {
    process.env.PLEXUS_CH_ROW_POLICY_SHADOW = OLD;
  });

  it("passes the query through unchanged and returns its result", async () => {
    const query = vi.fn().mockResolvedValue({ ok: true });
    const client = { query } as unknown as Parameters<typeof withShadowAudit>[0];
    const audited = withShadowAudit(client, "unscoped");
    const params = { query: "SELECT * FROM telemetry" };
    const res = await audited.query(params);
    expect(res).toEqual({ ok: true });
    expect(query).toHaveBeenCalledWith(params);
  });

  it("emits a [ch-shadow] warn for an unscoped tenant read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = {
      query: vi.fn().mockResolvedValue(null),
    } as unknown as Parameters<typeof withShadowAudit>[0];
    await withShadowAudit(client, "unscoped").query({ query: "SELECT * FROM events" });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("[ch-shadow]");
    expect(warn.mock.calls[0][0]).toContain('"risk":true');
  });

  it("does not warn for an org-scoped tenant read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const client = {
      query: vi.fn().mockResolvedValue(null),
    } as unknown as Parameters<typeof withShadowAudit>[0];
    await withShadowAudit(client, "org-scoped").query({ query: "SELECT * FROM telemetry" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("never lets an audit error break the read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("logging blew up");
    });
    const query = vi.fn().mockResolvedValue({ ok: true });
    const client = { query } as unknown as Parameters<typeof withShadowAudit>[0];
    // classifyRead → emit throws inside the try/catch; the read must still run.
    const res = await withShadowAudit(client, "unscoped").query({
      query: "SELECT * FROM telemetry",
    });
    expect(res).toEqual({ ok: true });
  });
});
