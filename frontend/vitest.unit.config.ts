import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * DB-free vitest config for pure unit suites (lib/dashboard, lib/transforms):
 * same aliases as vitest.config.ts but no setupFiles — the shared setup
 * migrates a local Postgres, which pure suites don't need.
 *
 *   npx vitest run --config vitest.unit.config.ts lib/dashboard/__tests__
 */
export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    pool: "forks",
  },
  resolve: {
    alias: {
      "server-only": path.resolve(
        __dirname,
        "lib/db/__tests__/stubs/server-only.ts",
      ),
      "@": path.resolve(__dirname),
    },
  },
});
