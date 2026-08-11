import { describe, it, expect } from "vitest";
import {
  detectTimeColumn,
  isIntegerType,
  isTimeType,
} from "@/lib/dashboard/column-roles";

describe("detectTimeColumn — insert-time preference", () => {
  const t = (type: string) => type;

  it("prefers created_at over updated_at (the signup-vs-login fix)", () => {
    expect(
      detectTimeColumn([
        { name: "id", type: "bigint" },
        { name: "email", type: "text" },
        { name: "last_login_at", type: t("timestamptz") },
        { name: "updated_at", type: t("timestamptz") },
        { name: "created_at", type: t("timestamptz") },
      ]),
    ).toBe("created_at");
  });

  it("avoids updated_at / last_* when no insert-time name exists", () => {
    expect(
      detectTimeColumn([
        { name: "updated_at", type: t("timestamptz") },
        { name: "signed_up", type: t("timestamptz") },
      ]),
    ).toBe("signed_up");
  });

  it("falls back to updated_at only if it is the only timestamp", () => {
    expect(
      detectTimeColumn([
        { name: "id", type: "bigint" },
        { name: "updated_at", type: t("timestamptz") },
      ]),
    ).toBe("updated_at");
  });

  it("returns undefined when there is no time-ish column", () => {
    expect(
      detectTimeColumn([
        { name: "id", type: "bigint" },
        { name: "email", type: "text" },
      ]),
    ).toBeUndefined();
  });
});

describe("type predicates", () => {
  it("isIntegerType matches int/serial types", () => {
    expect(isIntegerType("bigint")).toBe(true);
    expect(isIntegerType("integer")).toBe(true);
    expect(isIntegerType("bigserial")).toBe(true);
    expect(isIntegerType("numeric")).toBe(false);
    expect(isIntegerType("timestamptz")).toBe(false);
  });

  it("isTimeType matches timestamp/date/time", () => {
    expect(isTimeType("timestamp with time zone")).toBe(true);
    expect(isTimeType("date")).toBe(true);
    expect(isTimeType("text")).toBe(false);
  });
});
