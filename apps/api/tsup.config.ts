// Phase 2 Plan 02 — Build artifacts for the API container.
//
// Two entry points:
//   1. src/index.ts        -> dist/index.js  (ESM, runtime main bundle)
//   2. scripts/check-default-secrets.ts -> dist/scripts/check-default-secrets.cjs
//      (CJS, invoked by the container ENTRYPOINT before node main; closes
//      Phase 1 D-08 / SC#1 partial).
//
// CJS for the script is intentional: the entrypoint shell shells out to
// `node /app/dist/scripts/check-default-secrets.cjs` with no flags; CJS
// avoids ESM URL-resolution edge cases and keeps the file standalone.
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    target: "node24",
    outDir: "dist",
    clean: true,
    sourcemap: false,
    splitting: false,
    bundle: true,
  },
  {
    entry: { "scripts/check-default-secrets": "scripts/check-default-secrets.ts" },
    format: ["cjs"],
    target: "node24",
    outDir: "dist",
    clean: false,
    sourcemap: false,
    splitting: false,
    bundle: true,
  },
]);
