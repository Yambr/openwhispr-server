// Phase 2 Plan 02 — Build the migrate runner as a standalone CJS bundle.
//
// The one-shot `migrate` compose service runs
// `node /app/packages/data/dist/migrate.js` — bundle everything (drizzle,
// pg, schema) so there's no node_modules dependency at runtime in the
// container image (pnpm --prod deploy still ships them, but pre-bundling
// keeps cold-start tight and makes the entrypoint trivially relocatable).
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { migrate: "src/migrate.ts" },
  format: ["cjs"],
  // Force `.js` extension (rather than the tsup default `.cjs`) so the
  // compose `command: ["node", "/app/packages/data/dist/migrate.js"]` and
  // self-tests can rely on a stable artifact name regardless of format.
  outExtension: () => ({ js: ".js" }),
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
