// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "tsup";

// Phase 08 / Plan 03 — bundle the mock-litellm server for the
// `load-test-mock` compose profile. The runtime CMD is
// `node dist/server.js`, so we emit a single ESM entrypoint that
// transparently boots when invoked directly (see server-bootstrap.ts).
export default defineConfig({
  entry: ["src/server-bootstrap.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "node24",
  clean: true,
  sourcemap: true,
  splitting: false,
  bundle: true,
  // Emit as `dist/server.js` to match the Dockerfile CMD.
  outExtension: () => ({ js: ".js" }),
  esbuildOptions: (options) => {
    options.outbase = "src";
  },
});
