// Phase 07.1 / Plan 04 — axe-core/playwright wrapper.
//
// D-TEST-1: every screen runs `await runAxe(page)` and asserts zero
// violations against WCAG 2.0 A + AA and WCAG 2.2 AA. The combined tag
// list is what @axe-core/playwright recommends for the AA goal.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Run axe-core against the current page state and assert zero violations.
 * Tags map to deque-axe-core's `wcag2a`, `wcag2aa`, `wcag22aa` rulesets —
 * the canonical WCAG 2.2 AA goal called out in D-TEST-1.
 */
export async function runAxe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}
