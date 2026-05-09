// Phase 2 Plan 02 — Build artifacts for the API container.
// Phase 02.1 — make the api bundle self-contained for container runtime.
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
//
// `noExternal: [/^@openwhispr\//]` — workspace packages (@openwhispr/data,
// @openwhispr/contract-tests) are inlined into the bundle. Without this,
// the runtime container would need to ship those packages' TypeScript
// source (their `exports` maps point at `./src/*.ts`) plus a TS loader,
// which would defeat the purpose of bundling. Inlining keeps the runtime
// image small, removes any dependency on `pnpm deploy` (which broke under
// pnpm v10+ ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE), and makes the build
// reproducible from a flat `pnpm install --prod` of non-workspace deps.
//
// Phase 02.2 — `external: ["pg", "pg-native", "better-auth"]`. tsup's noExternal
// for @openwhispr/* transitively pulled in `pg` (via drizzle-orm/node-postgres
// inside @openwhispr/data) and tried to bundle its CommonJS into our ESM image,
// which broke at runtime with `require is not defined` on pg's native bindings.
// Native modules with C addons (pg) MUST stay external so Node loads them via
// the runtime node_modules. better-auth is also kept external because it ships
// dual ESM/CJS subpath exports that tsup can't reliably inline into pure ESM.
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
    noExternal: [/^@openwhispr\//],
    external: ["pg", "pg-native", "better-auth"],
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
