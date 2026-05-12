// Phase 08 / Plan 02 — k6 load-test bundle.
//
// k6 imports a flat ES bundle at runtime. The actual k6 flow files
// (transcribe.ts / reason.ts / agent-stream.ts / realtime-ws.ts) land
// in Wave 2 (plan 06); this Wave 0 config just establishes the build
// shape so plan 06 can drop entries in without re-thinking bundling.
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
});
