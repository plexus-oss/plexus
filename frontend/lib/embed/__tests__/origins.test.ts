import { describe, it, expect } from "vitest";
import {
  normalizeOrigin,
  domainOf,
  verificationRecord,
  verifyDomainOwnership,
  resolveAllowedOrigin,
  embedCorsHeaders,
  type TxtResolver,
} from "@/lib/embed/origins";

describe("normalizeOrigin", () => {
  it("keeps scheme+host, drops default port and trailing slash", () => {
    expect(normalizeOrigin("https://app.example.com/")).toBe("https://app.example.com");
    // Default https port is dropped — matches what a browser sends in Origin.
    expect(normalizeOrigin("https://app.example.com:443/")).toBe("https://app.example.com");
    expect(normalizeOrigin("https://App.Example.COM")).toBe("https://app.example.com");
  });

  it("keeps a non-default port", () => {
    expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("rejects anything with a path, query, or fragment", () => {
    expect(normalizeOrigin("https://app.example.com/embed")).toBeNull();
    expect(normalizeOrigin("https://app.example.com/?x=1")).toBeNull();
    expect(normalizeOrigin("https://app.example.com/#a")).toBeNull();
  });

  it("rejects non-http schemes and garbage", () => {
    expect(normalizeOrigin("ftp://example.com")).toBeNull();
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeOrigin("example.com")).toBeNull(); // no scheme
    expect(normalizeOrigin("")).toBeNull();
  });
});

describe("domainOf", () => {
  it("returns the hostname of a valid origin", () => {
    expect(domainOf("https://app.example.com:8443")).toBe("app.example.com");
  });
  it("is null for an invalid origin", () => {
    expect(domainOf("nope")).toBeNull();
  });
});

describe("verificationRecord", () => {
  it("builds the _plexus-verify TXT the customer must publish", () => {
    expect(verificationRecord("app.example.com", "abc123")).toEqual({
      type: "TXT",
      name: "_plexus-verify.app.example.com",
      value: "plexus-verify=abc123",
    });
  });
});

describe("verifyDomainOwnership", () => {
  const ok: TxtResolver = async () => [["plexus-verify=tok_good"]];
  const wrong: TxtResolver = async () => [["plexus-verify=someone_else"]];
  const chunked: TxtResolver = async () => [["plexus-verify=", "tok_good"]];
  const nxdomain: TxtResolver = async () => {
    throw new Error("ENOTFOUND");
  };

  it("passes when the TXT matches the token", async () => {
    expect(await verifyDomainOwnership("app.example.com", "tok_good", ok)).toBe(true);
  });
  it("joins split TXT chunks before matching", async () => {
    expect(await verifyDomainOwnership("app.example.com", "tok_good", chunked)).toBe(true);
  });
  it("fails on a wrong token", async () => {
    expect(await verifyDomainOwnership("app.example.com", "tok_good", wrong)).toBe(false);
  });
  it("fails (never throws) when the record is absent", async () => {
    expect(await verifyDomainOwnership("app.example.com", "tok_good", nxdomain)).toBe(false);
  });
  it("fails on empty inputs", async () => {
    expect(await verifyDomainOwnership("", "tok", ok)).toBe(false);
    expect(await verifyDomainOwnership("app.example.com", "", ok)).toBe(false);
  });
});

describe("resolveAllowedOrigin", () => {
  const verified = ["https://app.example.com", "https://dash.example.com"];

  it("reflects an exact verified origin", () => {
    expect(resolveAllowedOrigin("https://app.example.com", verified)).toBe(
      "https://app.example.com",
    );
  });
  it("normalizes the request origin before matching", () => {
    expect(resolveAllowedOrigin("https://app.example.com/", verified)).toBe(
      "https://app.example.com",
    );
  });
  it("denies an unverified origin", () => {
    expect(resolveAllowedOrigin("https://evil.com", verified)).toBeNull();
  });
  it("denies a subdomain that isn't explicitly verified", () => {
    expect(resolveAllowedOrigin("https://other.example.com", verified)).toBeNull();
  });
  it("denies a null or malformed origin", () => {
    expect(resolveAllowedOrigin(null, verified)).toBeNull();
    expect(resolveAllowedOrigin("garbage", verified)).toBeNull();
  });
});

describe("embedCorsHeaders", () => {
  it("reflects an allowed origin with Vary", () => {
    const h = embedCorsHeaders("https://app.example.com") as Record<string, string>;
    expect(h["Access-Control-Allow-Origin"]).toBe("https://app.example.com");
    expect(h["Vary"]).toBe("Origin");
  });
  it("emits no ACAO when the origin is denied", () => {
    const h = embedCorsHeaders(null) as Record<string, string>;
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(h["Vary"]).toBe("Origin");
  });
});
