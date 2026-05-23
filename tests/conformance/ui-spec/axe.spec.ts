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

// `bootStack()` budgets 240_000ms (compose-harness `DEFAULT_BOOT_TIMEOUT_MS`)
// for cold image-pull + container-start + Traefik-fronted /api/health
// readiness. Playwright's default hook timeout is 30_000ms — 8× too short
// on a CI runner with no Docker layer cache (verified: CI run 26342214898
// terminated mid-`docker compose pull` at the 30s mark). We therefore extend
// the per-hook timeout via `test.setTimeout()` inside the hook body — the
// Playwright-documented way to lengthen an individual hook's budget without
// affecting per-test timeouts. 300_000ms = bootStack budget (240s) + 60s
// margin for `docker compose up` orchestration overhead before readiness
// polling starts. The afterAll budget (120_000ms) covers `docker compose
// down -v --remove-orphans` teardown on a fully-booted stack.
test.beforeAll(async () => {
  test.setTimeout(300_000);
  const result = await bootStack();
  userStackWasRunning = result.userStackWasRunning;
});

test.afterAll(async () => {
  test.setTimeout(120_000);
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
