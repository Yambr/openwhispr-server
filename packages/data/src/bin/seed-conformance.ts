// SPDX-License-Identifier: FSL-1.1-ALv2
// Plan 51-21 — CLI entry for the conformance fixture seeder.
//
// Why a separate file: bundlers (esbuild via tsup) inline whole modules
// when downstream packages import named exports. When the CLI gate lived
// inside `src/seed/conformance.ts`, any `import { DEFAULT_TENANT_ID }
// from "@openwhispr/data/seed/conformance"` in the api bundle pulled in
// the `if (isEsmEntry || isCjsEntry) { seedConformanceFixtures()... }`
// block. The bundled `dist/index.js` of the api passes that gate at
// runtime (its own `import.meta.url === argv[1]`), and the api boot
// silently fires the seed flow against `https://api.localhost`, then
// `process.exit(1)` when the fetch fails — leaving operators with an
// unexplained restart loop. Library files stay pure; CLI entrypoints
// live under `bin/`.

/* v8 ignore start */
import { seedConformanceFixtures } from "../seed/conformance.js";

seedConformanceFixtures()
  .then((results) => {
    process.stdout.write("seed: conformance fixtures complete\n");
    for (const r of results) {
      process.stdout.write(
        `  ${r.email} created=${r.created} verifiedPatched=${r.verifiedPatched}\n`,
      );
    }
  })
  .catch((err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
/* v8 ignore stop */
