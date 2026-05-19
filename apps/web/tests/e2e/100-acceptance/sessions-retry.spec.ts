// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-06-b — Long-form acceptance: SessionsTable error → Retry click.
//
// Closes UC-SESSIONS-RETRY-CLICK (one of the 7 surfaces flagged by the
// Phase 55 UC coverage audit). SessionsTable.tsx:131-141 renders an Alert
// with a Retry button when authClient.listSessions() rejects. The button's
// onClick is `() => sessions.refetch()` (TanStack Query). U5 unit coverage
// asserts the call goes out (SessionsTable.test.tsx:211); this spec adds
// the long-form e2e half: real browser, real Better Auth, real network,
// real cookie jar.
//
// Why this surface is e2e-able under slim (unlike 55-06-a):
//   apps/web/src/app/(auth)/app/account/page.tsx does NOT prefetch
//   /api/auth/list-sessions server-side — it only resolves the session
//   via getServerSession() (which hits /api/auth/get-session). The
//   list-sessions call fires entirely client-side via TanStack Query
//   inside SessionsTable, so page.route('**/api/auth/list-sessions**')
//   wins the race. The Phase 53-33 slim-skip in fixtures/states.ts
//   `errorFor` does NOT apply here.
//
// Per-worker fixture-user inheritance — uses the standard alice+N pool
// (the test inherits storageState from fixtures/auth.ts via the chained
// `test` from fixtures/states.ts). We do NOT mutate sessions; only
// observe the table refetch.
//
// Slim-only by design (mirrors revoke-sessions.spec.ts) — production-
// equivalent routing is covered by the Phase 53 u5-account state matrix.

import { expect, test } from "../fixtures/states.js";
import {
  allowBrowserErrors,
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
} from "../support/browser-diagnostics.js";

const LIST_ROUTE = "**/api/auth/list-sessions**";

test.describe("@phase55-acceptance @long-form — sessions table retry button (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // eslint-disable-next-line prettier/prettier -- single-line skip required by Plan 55-06-b done-gate grep
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-06-b acceptance suite runs against slim topology only — traefik path covered by Phase 53 u5-account state matrix",
    );
    await attachBrowserDiagnostics(page);
    // The deliberate 500 stub surfaces as a network failure entry in
    // the diagnostics store. SessionsTable also throws "list-sessions
    // failed" inside the queryFn (SessionsTable.tsx:70) which TanStack
    // Query catches but re-emits as a console.error in dev mode.
    allowBrowserErrors(page, [
      /list-sessions[^\n]*500/i,
      /Failed to load resource[^\n]*list-sessions/i,
      /list-sessions failed/i,
      // Multi-navigation flow may cancel in-flight Next.js chunk prefetches.
      /GET [^ ]+\/_next\/static\/chunks\/[^ ]+ → FAILED: net::ERR_ABORTED/,
    ]);
  });

  test("sessions table retry: 500 → Alert + Retry → click → 200 → rows populate — zero browser errors", async ({
    page,
  }) => {
    await test.step("step 1 — pre-arm 500 stub on list-sessions BEFORE navigating to /app/account", async () => {
      await page.route(LIST_ROUTE, (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "fixture-500" }),
        }),
      );
    });

    await test.step("step 2 — goto /app/account, assert Alert + Retry rendered", async () => {
      await page.goto("/app/account");
      await expect(page).toHaveURL(/\/app\/account$/);
      // SessionsTable.tsx:131-141 — Alert title text + Retry button.
      await expect(page.getByText(/Could not load account/i)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: /^Retry$/i })).toBeVisible();
      // No session row badge while in error state.
      await expect(page.getByTestId("session-row-this-device")).toHaveCount(0);
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — unroute 500 stub so the next refetch hits the real API", async () => {
      // page.unroute releases the handler so subsequent requests for
      // the same URL fall through to the network (real Better Auth).
      await page.unroute(LIST_ROUTE);
    });

    await test.step("step 4 — click Retry, assert SessionsTable populates with current-device row", async () => {
      await page.getByRole("button", { name: /^Retry$/i }).click();
      // After sessions.refetch() resolves successfully, the error Alert
      // unmounts and the table renders. The current session row carries
      // the `session-row-this-device` data-testid (SessionsTable.tsx:187).
      await expect(page.getByTestId("session-row-this-device").first()).toBeVisible({
        timeout: 10_000,
      });
      // Error Alert is gone.
      await expect(page.getByText(/Could not load account/i)).toHaveCount(0);
      // Retry button is gone (we're back to the success branch).
      await expect(page.getByRole("button", { name: /^Retry$/i })).toHaveCount(0);
      expectNoBrowserErrors(page);
    });
  });
});
