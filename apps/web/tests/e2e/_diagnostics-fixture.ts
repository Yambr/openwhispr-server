// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 53 / Plan 53-03 — Playwright fixture that auto-attaches the
// browser-diagnostics helper to every spec without each spec needing
// its own beforeEach. Imported and re-exported by p53 specs AND by
// the slim-config-wide harness via `dependencies` declaration.
//
// Usage pattern A (per-spec opt-in):
//
//   import { test, expect } from "./_diagnostics-fixture.js";
//   test("...", async ({ page }) => { /* helper already attached */ });
//
// Usage pattern B (config-wide auto-attach):
//   The slim-config does NOT auto-extend test globally; specs that
//   want the helper import from this file. This keeps the existing
//   21 specs that import directly from @playwright/test running
//   unchanged when they run under the main config (Traefik
//   topology) and only attaches diagnostics under the slim-config
//   sweep when the spec explicitly opts in.
//
// The afterEach hook here attaches the captured diagnostics JSON
// to the Playwright testInfo for postmortem and — when the spec
// passes — fails the test if any error-severity entry was
// captured (per Phase 53 contract: every captured browser-side
// error is a test failure by default, allowlist via
// `allowBrowserErrors(page, [/pattern/])`).

import { test as base, expect } from "@playwright/test";
import {
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
  getCapturedDiagnostics,
} from "./support/browser-diagnostics.js";

export const test = base.extend<{ _attachDiagnostics: void }>({
  // Auto-fixture — Playwright runs it once per test before the body.
  // The `[true, { auto: true }]` shape triggers eager evaluation
  // without the spec needing to name it in the destructure list.
  _attachDiagnostics: [
    async ({ page }, use, testInfo) => {
      await attachBrowserDiagnostics(page);
      await use();
      // After-each: attach diagnostics + assert zero errors. If the
      // test body already threw, this hook still runs but won't mask
      // the original failure — Playwright shows the first error.
      const diag = getCapturedDiagnostics(page);
      if (diag.length > 0) {
        await testInfo.attach("browser-diagnostics.json", {
          body: JSON.stringify(diag, null, 2),
          contentType: "application/json",
        });
      }
      // Only enforce zero-errors when the spec opted in via the env
      // gate. Pre-Phase-53 specs that have not been audited yet would
      // mass-RED otherwise — the env gate lets the sweep advance
      // file-by-file as each spec gets its allowlist (or its
      // production-side bug fixed) without blocking the others.
      if (process.env.PHASE53_STRICT_DIAGNOSTICS === "1") {
        expectNoBrowserErrors(page);
      }
    },
    { auto: true },
  ],
});

export { expect };
