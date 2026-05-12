// Phase 08 / Plan 06 — k6 load-test bundle.
//
// k6 imports a flat ES bundle at runtime. The k6 globals (`k6`, `k6/http`,
// `k6/websockets`, `k6/metrics`, `k6/encoding`) MUST remain as bare
// imports in the bundle because k6's VM injects them at script init —
// bundling them would produce `Error: Cannot find module 'k6/http'` at
// runtime. tsup forwards `noExternal: []` so we additionally use
// esbuild's `external` (via the `esbuildOptions` hook) to mark every
// k6/* subpath as a runtime resolution.
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts", "src/smoke.ts", "src/baseline.ts"],
  format: ["esm"],
  target: "es2022",
  outDir: "dist",
  bundle: true,
  sourcemap: true,
  splitting: false,
  clean: true,
  external: ["k6", "k6/http", "k6/websockets", "k6/metrics", "k6/encoding"],
  esbuildOptions(options) {
    // Belt-and-braces: esbuild treats `external` as a per-call array,
    // not the tsup-level one, so we propagate both. This guarantees the
    // bundle keeps `import http from "k6/http"` as a bare specifier.
    options.external = ["k6", "k6/http", "k6/websockets", "k6/metrics", "k6/encoding"];
  },
  // Fixture copy is performed in package.json scripts (`build`) rather
  // than tsup's onSuccess: in tsup 8.x, onSuccess runs asynchronously
  // and the parent process can exit (pnpm filter) before the copy
  // settles when stdout is piped to a non-TTY (as run.sh does).
});
