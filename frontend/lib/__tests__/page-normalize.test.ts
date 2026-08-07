import { describe, it, expect } from "vitest";
import { normalizePath } from "@/components/page-view-tracker";

describe("normalizePath (self-analytics tag cardinality)", () => {
  it("keeps feature roots and static sub-pages", () => {
    expect(normalizePath("/devices")).toBe("/devices");
    expect(normalizePath("/alerts/monitors")).toBe("/alerts/monitors");
    expect(normalizePath("/settings")).toBe("/settings");
    expect(normalizePath("/")).toBe("/");
  });

  it("collapses ids and slugs", () => {
    expect(normalizePath("/devices/drone-001")).toBe("/devices/:id");
    expect(normalizePath("/devices/sat-25544")).toBe("/devices/:id");
    expect(
      normalizePath("/dashboards/123e4567-e89b-12d3-a456-426614174000/settings"),
    ).toBe("/dashboards/:id/settings");
    expect(normalizePath("/connections/prod-postgres")).toBe(
      "/connections/:id",
    );
  });

  it("truncates unknown roots to one segment", () => {
    expect(normalizePath("/shared/abc123token")).toBe("/shared");
    expect(normalizePath("/auth/cli/whatever")).toBe("/auth");
  });
});
