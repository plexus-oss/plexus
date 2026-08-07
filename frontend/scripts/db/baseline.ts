// ONE-TIME: adopt the Drizzle migrator on an existing database whose schema
// already reflects the early migrations (e.g. prod, built by the legacy Supabase
// migrations). Marks every migration BEFORE the cutoff as already-applied in
// drizzle.__drizzle_migrations WITHOUT running their SQL, so a subsequent
// `db:migrate` runs only the newer ones (0003+).
//
//   npm run db:baseline -- --env-file=.env.production            # mark 0000–0002 applied
//   npm run db:baseline -- --env-file=.env.production --dry-run  # show, don't write
//   npm run db:baseline -- --through=0003                        # cutoff (default 0003)
//
// Environment-relative like migrate.ts: ambient DATABASE_URL by default, or pass
// --env-file. Idempotent — already-recorded migrations are skipped.
//
// Note: the node-postgres migrator gates by the MAX created_at already in the
// table, so the cutoff row is what actually matters; we still insert each early
// migration with its real hash for an accurate ledger.

import { readFileSync, existsSync } from "node:fs";
import { Pool } from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";

const MIGRATIONS_DIR = "lib/db/migrations/drizzle";
const DEFAULT_THROUGH = "0003"; // mark every migration tagged BEFORE this as applied

function flag(argv: string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return argv[i + 1] ?? "";
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const envFile = flag(argv, "env-file");
  const through = flag(argv, "through") || DEFAULT_THROUGH;
  const dryRun = argv.includes("--dry-run");

  if (envFile) {
    if (!existsSync(envFile)) {
      console.error(`--env-file: ${envFile} not found`);
      process.exit(1);
    }
    const { config } = await import("dotenv");
    config({ path: envFile, override: true });
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set — provide it in the environment, or pass --env-file <path>");
    process.exit(1);
  }
  try {
    const u = new URL(url);
    console.log(`[baseline] target: ${u.host}${u.pathname}`);
  } catch {
    /* let pg surface a bad URL */
  }

  // Journal is the ordered source of tags; find how many to mark (everything
  // before the cutoff tag).
  const journal = JSON.parse(
    readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const cutoffIdx = ordered.findIndex((e) => e.tag.startsWith(through));
  const markCount = cutoffIdx === -1 ? ordered.length : cutoffIdx;
  if (markCount === 0) {
    console.log(`nothing to mark before "${through}" — aborting`);
    return;
  }

  // readMigrationFiles returns entries in the same (journal) order, with the
  // exact hash + folderMillis the migrator uses.
  const files = readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR });
  const toMark = files.slice(0, markCount);

  console.log(
    `[baseline] will mark ${markCount} migration(s) applied (through < ${through}):`,
  );
  toMark.forEach((m, i) =>
    console.log(`  ${ordered[i].tag}  hash=${m.hash.slice(0, 12)}…  millis=${m.folderMillis}`),
  );

  if (dryRun) {
    console.log("[baseline] --dry-run: no writes.");
    return;
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
    );
    let inserted = 0;
    for (const m of toMark) {
      const { rowCount } = await client.query(
        `SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash = $1`,
        [m.hash],
      );
      if (rowCount && rowCount > 0) continue;
      await client.query(
        `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
        [m.hash, m.folderMillis],
      );
      inserted++;
    }
    console.log(`✓ baseline complete — ${inserted} new ledger row(s), ${markCount - inserted} already present`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
