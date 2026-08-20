import { defineConfig } from "tsup";
import path from "node:path";

const FRONTEND = path.resolve(__dirname, "../frontend");

// Bundle the PlexusPanel component (and its self-contained chart tree) out of the
// frontend source into a standalone, dependency-free ESM+CJS package. `@/` is
// resolved to the frontend root via tsconfig paths; React stays external (peer).
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: false, // hand-authored dist/index.d.ts — props are self-contained primitives
  clean: true,
  treeshake: true,
  minify: true,
  external: ["react", "react-dom", "react/jsx-runtime"],
  esbuildOptions(options) {
    options.tsconfig = path.resolve(__dirname, "tsconfig.json");
    options.nodePaths = [path.join(FRONTEND, "node_modules")];
  },
});
