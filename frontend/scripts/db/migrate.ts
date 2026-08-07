// Apply Drizzle migrations to the database in DATABASE_URL.
//
// Environment-relative by default: reads DATABASE_URL from the AMBIENT
// environment — Fly secrets in prod (via the deploy release_command), your shell
// in CI, or whatever exported it (scripts/db/up.sh exports it from .env.local
// before invoking this for the local bootstrap).
//
// For ad-hoc local/targeted runs, point it at an env file explicitly:
//   tsx scripts/db/migrate.ts --env-file .env.local
//   npm run db:migrate -- --env-file=.env.local
//
// No env file is loaded unless you ask for one, so this never silently targets
// the wrong database. Runs under tsx OUTSIDE Next — must NOT import "server-only".

import { existsSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const MIGRATIONS_DIR = "lib/db/migrations/drizzle";

// Optional `--env-file <path>` / `--env-file=<path>` — explicit opt-in only.
function envFileArg(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--env-file") return argv[i + 1];
    if (a.startsWith("--env-file=")) return a.slice("--env-file=".length);
  }
  return undefined;
}

async function main() {
  const envFile = envFileArg(process.argv.slice(2));
  if (envFile) {
    if (!existsSync(envFile)) {
      console.error(`--env-file: ${envFile} not found`);
      process.exit(1);
    }
    // dotenv is imported only on the explicit-file path; the ambient/prod path
    // never touches it. `override` so the file you asked for actually wins.
    const { config } = await import("dotenv");
    config({ path: envFile, override: true });
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL not set — provide it in the environment, or pass --env-file <path>",
    );
    process.exit(1);
  }

  if (!existsSync(`${MIGRATIONS_DIR}/meta/_journal.json`)) {
    console.log("no Drizzle migrations yet — skipping");
    return;
  }

  // Always announce the target DB (host + db only, no credentials) so a run can
  // never quietly hit the wrong environment.
  try {
    const u = new URL(url);
    console.log(`[migrate] target: ${u.host}${u.pathname}`);
  } catch {
    /* unparseable URL — let pg surface the error */
  }

  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
    console.log("✓ migrations applied");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
