import { describe, it, expect } from "vitest";
import { Pool } from "pg";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/plexus_test";

describe("test foundation", () => {
  it("connects to the test database", async () => {
    const pool = new Pool({ connectionString: TEST_URL });
    try {
      const res = await pool.query("SELECT 1 as ok");
      expect(res.rows[0].ok).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it("starts with an empty sources table (truncate works)", async () => {
    const pool = new Pool({ connectionString: TEST_URL });
    try {
      const res = await pool.query("SELECT count(*) as n FROM public.sources");
      expect(Number(res.rows[0].n)).toBe(0);
    } finally {
      await pool.end();
    }
  });
});
