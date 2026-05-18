// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 04 — axe-core/playwright wrapper.
// Phase 18.1.1 / Plan 05 / Task 05-03 — optional baseline write/read
// (D-33). When `AXE_BASELINE=1` and a screen ID is supplied, the
// helper persists pass/incomplete counts to
// tests/e2e/__axe-baselines__/<screenId>.json and asserts no regression
// on subsequent runs. The original zero-violation assertion stays
// unconditional.
//
// D-TEST-1: every screen runs `await runAxe(page)` and asserts zero
// violations against WCAG 2.0 A + AA and WCAG 2.2 AA. The combined tag
// list is what @axe-core/playwright recommends for the AA goal.
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { compareOrWriteBaseline } from "../../../src/lib/axe-baseline";

// Phase 53 / Plan 53-15 — removed `import.meta.url` (ESM-only) which
// caused `ReferenceError: exports is not defined in ES module scope`
// when Playwright's loader transpiles axe.ts under the CJS interpretation
// of apps/web (no `"type": "module"` in package.json). Baselines live
// at a stable path relative to process.cwd() (always apps/web when
// invoked via `pnpm playwright test`), so we anchor there.
const BASELINES_DIR = path.resolve(process.cwd(), "tests/e2e/__axe-baselines__");

/**
 * Run axe-core against the current page state and assert zero violations.
 * Tags map to deque-axe-core's `wcag2a`, `wcag2aa`, `wcag22aa` rulesets —
 * the canonical WCAG 2.2 AA goal called out in D-TEST-1.
 *
 * @param screenId Optional baseline-tracking key (writes/asserts
 *   `tests/e2e/__axe-baselines__/<screenId>.json` when `AXE_BASELINE=1`).
 */
export async function runAxe(page: Page, screenId?: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  if (screenId && process.env.AXE_BASELINE === "1") {
    const file = path.join(BASELINES_DIR, `${screenId}.json`);
    await compareOrWriteBaseline({
      file,
      live: {
        url: page.url(),
        passes: results.passes.length,
        incomplete: results.incomplete.length,
      },
      mode: process.env.AXE_UPDATE_BASELINE === "1" ? "update" : "compare",
    });
  }
}
