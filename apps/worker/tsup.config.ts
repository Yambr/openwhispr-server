// Phase 03 Plan 08 — apps/worker bundle.
//
// Single CJS bundle for the long-running worker container. CJS chosen for
// the same reason as packages/data/migrate.cjs — the runtime container
// invokes `node /app/apps/worker/dist/index.cjs` without flags; CJS is
// the friendliest target for `node` direct invocation and avoids ESM
// URL-resolution surprises when the file ships standalone.
//
// Native modules (pg) stay external so the runtime image's flat
// node_modules supplies them — same pattern as the api bundle (Phase 02.2).
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["cjs"],
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  splitting: false,
  bundle: true,
  external: ["pg", "pg-native"],
});
