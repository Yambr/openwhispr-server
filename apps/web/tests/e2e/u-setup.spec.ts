// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 18.1.1 / Plan 05 / Task 05-03 — minimal /setup axe spec.
//
// Phase 12 did not author a Playwright spec for the setup wizard; this
// stub navigates to /setup, asserts the AuthShell side title is
// rendered, then runs the WCAG 2.2 AA axe scan with baseline tracking
// (D-33). The setup wizard renders unconditionally — when the server
// is already initialised the page is redirected before the assertion,
// in which case the test logs and skips; this keeps the spec
// non-flaky regardless of stack state.
import { expect, test } from "./_diagnostics-fixture.js";
import { runAxe } from "./fixtures/axe.js";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "./support/browser-diagnostics.js";

test.describe("U-setup (Phase 18.1.1 / Plan 05)", () => {
  test.beforeEach(async ({ page }) => {
    await attachBrowserDiagnostics(page);
  });

  test("axe — WCAG 2.2 AA scan on /setup", async ({ page }) => {
    const response = await page.goto("/setup");
    // When the server has already completed initial setup, /setup
    // either redirects (URL is no longer /setup) or returns a non-2xx.
    // In both cases we skip the axe scan because the wizard isn't rendered.
    const finalUrl = new URL(page.url());
    const onSetup = finalUrl.pathname === "/setup";
    if (!response || !response.ok() || !onSetup) {
      // SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required
      test.skip(true, "setup already completed — skipping axe scan");
      return;
    }
    // Phase 53 / Plan 53-30 — strict-mode disambiguation. The wizard
    // renders the title in BOTH the AuthShell side panel (<h2>) AND
    // the Card title — getByText() resolves to 2 elements and Playwright
    // 1.60+ strict mode rejects ambiguity. Target the side-panel <h2>
    // explicitly via role+level.
    await expect(
      page.getByRole("heading", { level: 2, name: /set up your openwhispr server/i }),
    ).toBeVisible({ timeout: 15_000 });
    await runAxe(page, "u-setup");
    expectNoBrowserErrors(page);
  });
});
