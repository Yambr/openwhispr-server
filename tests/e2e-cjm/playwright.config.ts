// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 / Plan 01 / Task 01 — playwright-bdd 8.4.2 entrypoint.
//
// Per the upstream playwright-bdd 8.x API (verified against
// node_modules/playwright-bdd/dist/config/types.d.ts and dist/cli/commands/test.js),
// the BDD configuration lives INSIDE the Playwright config via
// `defineBddConfig({...})` — there is no standalone `bddgen.config.ts`. The
// `bddgen` CLI loads this file via `-c/--config <playwright.config.ts>`,
// reads the BDD config via `getEnvConfigs()`, and generates spec files into
// `outputDir`.
//
// D-12 invariant: NEVER set Playwright `retries` > 0 in this harness — the
// e2e-cjm harness is a deterministic ships-first gate; retry-on-flake is
// BANNED. If a scenario is flaky, the harness MUST fail loud.
import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

// playwright-bdd 8.4.2: BDDInputConfig shape (see
// node_modules/playwright-bdd/dist/config/types.d.ts):
//   - `features`: glob(s) for Gherkin files
//   - `steps`:    glob(s) for step-definition files
//   - `outputDir`: directory for generated specs
//   - `importTestFrom`: file that exports the `test` instance to be used by
//     generated specs (final shape lands in Task 13-01-07; placeholder shell
//     wired in this task per the plan).
//   - `verbose`: print generated paths on stdout (useful for the bddgen
//     verification step run in Task 13-01-01).
// playwright-bdd 8.4.2 deprecates `importTestFrom`; the `world.ts` file is
// instead picked up by the `steps` glob. We include `support/**/*.ts` in the
// steps pattern so the world (which calls `createBdd(test)` and binds the
// Given/When/Then DSL) is loaded before any step file references it.
// Phase 19a / SR-19a.4 — exclude `steps/__tests__/**` from the bdd
// step-load glob. Those files are vitest unit tests for step-helper
// modules (e.g. tls-cert-paths.test.ts from Phase 17 WR-01). They
// import `describe`/`it` from vitest; playwright-bdd's loadStepsFromFile
// executes them at boot and they throw `Cannot read properties of
// undefined (reading 'config')` because vitest's runner is not present.
// The compiled step modules themselves (e.g. tls-cert-paths.ts) ARE
// scanned via the `steps/**/*.ts` glob.
const testDir = defineBddConfig({
  features: "features/**/*.feature",
  steps: ["support/world.ts", "steps/**/*.ts", "!steps/**/__tests__/**"],
  outputDir: ".bdd-gen",
  verbose: true,
});

export default defineConfig({
  testDir,
  // D-12: retry-on-flake BANNED. DO NOT BUMP.
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    // Phase 15 / Plan 02 (STRUCT-05) — host split: the web app lives at
    // web.localhost; api.localhost is reserved for the Fastify api
    // container (see compose/traefik/dynamic.dev.yml). Prior baseURL
    // was app.localhost which had no Traefik router declared and was
    // implicitly captured by the api router (TD-15.g).
    baseURL: "https://web.localhost",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
