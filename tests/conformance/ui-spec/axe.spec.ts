// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 05b / Task 2 — UICONF-05 axe baseline.
//
// Real Chromium against the booted Phase 13 compose stack via the
// `bootStack()` / `tearStack()` primitives from
// `tests/e2e-cjm/support/compose-harness.ts` (no separate compose project —
// reuse the Phase 13 `-p e2e-cjm` stack).
//
// Per RESEARCH §12 (lines 705-725) the verbatim spec template uses
// `http://localhost${route}` — that URL does NOT resolve against the
// Traefik-fronted compose stack (which publishes on https://app.localhost
// with a self-signed cert). Per CLAUDE.md "no mocks / real services", we
// honor the spec INTENT (5 routes, AxeBuilder, WCAG-2.1-AA tags, zero
// violations) and use `page.goto(route)` so Playwright resolves against
// `use.baseURL = "https://app.localhost"` from playwright.config.ts. The
// route list, tag set, and `expect(violations).toEqual([])` assertion are
// preserved byte-for-byte from the research template. See plan 12-05b
// SUMMARY for the deviation log (Rule 1 — URL bug in verbatim snippet).
//
// Rule-tag set is the locked CONTEXT D-19 choice:
//   wcag2a + wcag2aa + wcag21a + wcag21aa
// NO `.disableRules(...)` / `.withRules(...)` allowed — honest
// zero-violation is the only pass condition (threat T-12.05b-04).
//
// D-22 invariant: NO retry-on-flake. If a route fails axe, fix the
// underlying production component (Plans 12-01..12-04) — never mask.

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { bootStack, tearStack } from "../../e2e-cjm/support/compose-harness";

let userStackWasRunning = false;

test.beforeAll(async () => {
  const result = await bootStack();
  userStackWasRunning = result.userStackWasRunning;
});

test.afterAll(async () => {
  await tearStack({ userStackWasRunning });
});

for (const route of ["/sign-in", "/sign-up", "/verify-email", "/setup", "/admin"]) {
  test(`axe baseline: ${route}`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
