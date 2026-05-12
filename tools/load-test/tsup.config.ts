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
  entry: ["src/main.ts"],
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
  // k6's `open()` is the only mechanism for static fixture loading and
  // it resolves paths RELATIVE TO THE BUNDLE FILE at runtime (not the
  // source). Without copying src/fixtures/ next to dist/main.js, every
  // k6 run aborts with `stat .../dist/fixtures/sample-5s-16k.wav: no
  // such file or directory`. tsup's onSuccess fires after every build
  // (initial + watch), so the copy stays in sync. Plan 08-07 fix.
  onSuccess: "cp -R src/fixtures dist/fixtures",
});
