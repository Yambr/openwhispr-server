// Phase 2 Plan 02 — Build the migrate runner as a standalone CJS bundle.
// Phase 01.2 — restore default .cjs extension to disambiguate from the
// api container's `type: module` package.json which would otherwise force
// Node to load this bundle as ESM and crash on its `require()` calls.
//
// The one-shot `migrate` compose service runs
// `node /app/packages/data/dist/migrate.cjs` — bundle everything (drizzle,
// pg, schema) so there's no node_modules dependency at runtime in the
// container image. The file's CJS format is now reflected by its extension,
// so Node's ESM/CJS detection works correctly regardless of any sibling
// package.json `type` field.
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { migrate: "src/migrate.ts" },
  format: ["cjs"],
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  splitting: false,
  bundle: true,
  // pg uses dynamic require for its native bindings; keep them external so
  // node finds them at runtime from the deployed node_modules tree.
  external: ["pg-native"],
});
