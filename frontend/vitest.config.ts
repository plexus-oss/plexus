import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    pool: "forks",
    setupFiles: ["./lib/db/__tests__/setup.ts"],
  },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "lib/db/__tests__/stubs/server-only.ts"),
      "@": path.resolve(__dirname),
    },
  },
});
