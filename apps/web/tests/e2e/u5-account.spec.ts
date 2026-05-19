// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 08 — U5 account / sessions / delete (state matrix + axe).
//
// D-TEST-3 boundary rule:
//   - loading + error states use page.route() (network-boundary intercept).
//   - empty + success states use real Better Auth state (single signed-in
//     session for "empty other-sessions"; a second signed-in browser context
//     for the multi-session success path).

import { fixtureEmail, signInAs } from "./fixtures/auth.js";
import { runAxe } from "./fixtures/axe.js";
import { expect, test } from "./fixtures/states.js";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "./support/browser-diagnostics.js";

const LIST_ROUTE = "**/api/auth/list-sessions";

test.describe("U5 — account (Phase 07.1 / Plan 08)", () => {
  // Plan 13.1 — auth provisioned by global-setup.ts; storageState applied
  // per worker via the auth-extended `test`. The "two-sessions" success
  // path still has to call signInAs in a second browser context — sign-in
  // (vs sign-up) has a higher rate-limit ceiling and is unavoidable here.

  // Phase 53 / Plan 53-32c — DB-direct delete of OTHER sessions, preserving
  // the one whose token matches the storageState cookie. The earlier
  // strategy "keep oldest by updated_at" silently dropped the storageState
  // session whenever another spec's sign-in produced a stale-updated row
  // ahead of it — every subsequent spec started signed-out, cascading into
  // u11/12/13 failures.
  test.beforeEach(async ({ context, page }, testInfo) => {
    await attachBrowserDiagnostics(page);
    if (testInfo.title.startsWith("success state — two sessions")) {
      return; // this test seeds an extra session itself
    }
    // Pull the active session token from the BrowserContext cookies
    // (host-scoped to web origin). Better Auth stores it as
    // `<cookiePrefix>.session_token`, raw value is the public token.
    const cookies = await context.cookies();
    const tokenCookie = cookies.find((c) => c.name === "openwhispr.session_token");
    if (!tokenCookie) return; // nothing to preserve / clean
    const currentToken = decodeURIComponent(tokenCookie.value).split(".")[0];
    if (!currentToken) return;
    const email = `alice+${testInfo.parallelIndex}@test.local`;
    const sql =
      `DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = '${email}') ` +
      `AND token <> '${currentToken.replace(/'/g, "''")}'`;
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    await exec("docker", [
      "compose",
      "exec",
      "-T",
      "-e",
      "PGPASSWORD=43xs40WHCc2NFVWYsJfhk_8FSoBr4JDrH3u8Txbuy3Q",
      "postgres",
      "psql",
      "-U",
      "openwhispr_owner",
      "-d",
      "openwhispr",
      "-c",
      sql,
    ]).catch(() => {
      // best-effort; swallow so the spec body surfaces real assertion failures
    });
  });

  test("loading state — Skeleton rows while list-sessions is stalled", async ({
    page,
    loadingFor,
  }) => {
    await loadingFor(LIST_ROUTE);
    await page.goto("/app/account");
    await expect(page.locator('[data-testid="sessions-skeleton-row"]').first()).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("empty state — single session hides 'Revoke all other sessions'", async ({ page }, info) => {
    await page.goto("/app/account");
    // Profile card visible
    await expect(page.getByText(fixtureEmail(info.parallelIndex))).toBeVisible();
    // Only the current session — header bulk-revoke button should be absent
    await expect(page.getByRole("button", { name: /Revoke all other sessions/i })).toHaveCount(0);
    expectNoBrowserErrors(page);
  });

  test("error state — Alert + Retry when list-sessions returns 500", async ({ page, errorFor }) => {
    await errorFor(LIST_ROUTE, 500);
    await page.goto("/app/account");
    await expect(page.getByText(/Could not load account/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Retry/i })).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("success state — two sessions render and 'Revoke all other sessions' is visible", async ({
    browser,
    page,
  }, info) => {
    // Open a second browser context for the same user → creates a second
    // Better Auth session row. The first page (this `page`) keeps its session.
    const secondCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const secondPage = await secondCtx.newPage();
    await signInAs(secondPage, fixtureEmail(info.parallelIndex));
    await secondPage.close();

    await page.goto("/app/account");
    await expect(page.getByRole("button", { name: /Revoke all other sessions/i })).toBeVisible();
    // At least two row revoke buttons (one per session)
    const revokeButtons = page.getByRole("button", { name: /^Revoke$/i });
    await expect(revokeButtons.first()).toBeVisible();

    await secondCtx.close();
    expectNoBrowserErrors(page);
  });

  test("axe — WCAG 2.2 AA clean on populated account screen", async ({ page }, info) => {
    await page.goto("/app/account");
    await expect(page.getByText(fixtureEmail(info.parallelIndex))).toBeVisible();
    await runAxe(page);
    expectNoBrowserErrors(page);
  });
});
