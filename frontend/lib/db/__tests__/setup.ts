import { beforeAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/plexus_test";

process.env.DATABASE_URL = TEST_URL;

const MIGRATIONS_DIR = "lib/db/migrations/drizzle";

let migrated = false;

async function ensureTestDb(): Promise<void> {
  const adminUrl = new URL(TEST_URL);
  const adminPool = new Pool({
    connectionString: `postgresql://${adminUrl.username}:${adminUrl.password}@${adminUrl.host}/postgres`,
  });
  try {
    const res = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [adminUrl.pathname.slice(1)],
    );
    if (res.rowCount === 0) {
      await adminPool.query(
        `CREATE DATABASE ${adminUrl.pathname.slice(1)}`,
      );
    }
  } finally {
    await adminPool.end();
  }
}

async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  await ensureTestDb();
  const pool = new Pool({ connectionString: TEST_URL });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
    migrated = true;
  } finally {
    await pool.end();
  }
}

async function truncateAll(): Promise<void> {
  const pool = new Pool({ connectionString: TEST_URL });
  try {
    await pool.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
  } finally {
    await pool.end();
  }
}

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
});
