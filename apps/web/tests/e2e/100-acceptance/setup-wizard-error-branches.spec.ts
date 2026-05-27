// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-16 — Long-form acceptance: /setup wizard error + warning branches.
//
// Closes 2 MISSING UCs from RESEARCH.md §"/setup" (SetupForm.tsx,
// 416 LOC). The wizard's onSubmit (lines 178-203) has THREE
// post-fetch branches, of which the happy-path (201/200 with no
// warnings, redirect to /admin) is covered by setup-wizard-happy-path
// .spec.ts. This spec covers the remaining two:
//
//   UC-SETUP-WIZARD-GENERIC-ERROR
//     SetupForm.tsx:188-197 — a non-2xx response sets errorKind
//     "generic"; SetupForm.tsx:243-248 renders a destructive Alert
//     with title "Setup failed" and body
//     "Could not finish setup. Review the form and try again."
//
//   UC-SETUP-WIZARD-WARNING-RENAME-FAILED
//     SetupForm.tsx:188-195 — a 201 with warnings:["tenant_rename_failed"]
//     sets warningKind, renders a non-destructive Alert (role="status")
//     with body "Admin created, but the workspace name could not be
//     saved. You can change it later from the admin panel." then still
//     pushes /admin. The Alert is set synchronously BEFORE router.push;
//     to keep the wizard mounted long enough to observe the Alert the
//     spec pre-arms a delayed stub on the /admin RSC navigation URL so
//     the client-side push hangs while we assert.
//
// Approach: stub /api/setup/admin via page.route() to return the two
// non-happy shapes. Reset setup-state via POST /api/_test/reset-setup
// (landed in 55-05 — gated by OPENWHISPR_TEST_ROUTES=true on slim).
//
// Slim-only (matches the rest of the 100-acceptance suite). No fixture
// user — the setup wizard renders for unauthenticated visitors only.
// The deliberate 400 in the generic-error test is expected as a
// browser-side error and is allowlisted.
//
// EN-only matchers per constitutional rule.

import { test as base, expect } from "@playwright/test";
import {
  allowBrowserErrors,
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
} from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";
const API_BASE = "http://localhost:4000";
const SETUP_ADMIN_ROUTE = "**/api/setup/admin";

// Fixture values — these never reach the real handler (page.route stubs
// the POST), so they only need to clear the client-side setupSchema
// (12+ chars, upper+lower+digit).
const FIXTURE_NAME = "Setup Wizard Error Tester";
const FIXTURE_EMAIL = "setup-wizard-55-16@test.local";
const FIXTURE_PASSWORD = "ErrorBranch55!Strong";
const FIXTURE_WORKSPACE = "Error Branch Workspace 55-16";
const FIXTURE_TIMEZONE = "Europe/London";

const test = base.extend({});
test.use({
  storageState: { cookies: [], origins: [] },
  // Align SSR + CSR — see setup-wizard-happy-path.spec.ts for rationale.
  timezoneId: "Europe/London",
});

/** Fill the 3-section wizard (Identity → Workspace → Review). Mirrors
 *  setup-wizard-happy-path.spec.ts steps 1-5 minus the per-step assertion
 *  noise — this spec's RED/GREEN signal is the Alert, not the wizard
 *  fill itself (which is owned by the happy-path spec). */
async function fillWizard(page: import("@playwright/test").Page): Promise<void> {
  await page.goto(`${WEB_BASE}/setup`);
  await expect(page.getByRole("heading", { name: /Set up your OpenWhispr server/i })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByLabel(/^Name$/i).fill(FIXTURE_NAME);
  await page.getByLabel(/^Email$/i).fill(FIXTURE_EMAIL);
  await page.getByLabel(/^Password$/i).fill(FIXTURE_PASSWORD);
  await page.locator("section#workspace").scrollIntoViewIfNeeded();
  await page.getByLabel(/^Workspace name$/i).fill(FIXTURE_WORKSPACE);
  await page.getByLabel(/^Timezone$/i).selectOption(FIXTURE_TIMEZONE);
  await page.locator("section#review").scrollIntoViewIfNeeded();
}

test.describe("@phase55-acceptance @long-form — setup wizard error + warning branches (slim)", () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    // eslint-disable-next-line prettier/prettier -- single-line skip required by Plan 55-16 done-gate grep
    // SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-16 acceptance suite runs against slim topology only — traefik path covered by Phase 53 sweep + CJM suite",
    );
    // Hermetic reset — restores setup_state.status to 'pending' so the
    // /setup wizard re-renders. Without this seam the slim docker
    // instance bootstraps with status='completed' from prior runs and
    // /setup 302s to /admin.
    const resetRes = await request.post(`${API_BASE}/api/_test/reset-setup`);
    expect(resetRes.status(), "reset-setup endpoint must be reachable").toBe(200);
    const resetBody = (await resetRes.json()) as { ok: boolean };
    expect(resetBody.ok).toBe(true);
    await attachBrowserDiagnostics(page);
  });

  test("generic-error branch: 400 from /api/setup/admin renders destructive Alert with Setup failed copy", async ({
    page,
  }) => {
    // The deliberate 400 surfaces as a browser-side error
    // (`Failed to load resource: the server responded with a status of
    // 400 ...`) and as a network-failure entry in browser-diagnostics.
    // Allowlist both shapes.
    allowBrowserErrors(page, [/setup\/admin.*400/i, /Failed to load resource[^\n]*setup\/admin/i]);

    await test.step("step 1 — pre-arm 400 stub on /api/setup/admin BEFORE navigating", async () => {
      await page.route(SETUP_ADMIN_ROUTE, (route) =>
        route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "ADMIN_CREATE_FAILED", message: "server explosion" },
          }),
        }),
      );
    });

    await test.step("step 2 — fill the wizard (Identity → Workspace → Review)", async () => {
      await fillWizard(page);
      // The "Setup failed" Alert must NOT be present at form-idle —
      // confirms the wizard has not pre-rendered the error variant.
      await expect(page.getByText(/Setup failed/i)).toHaveCount(0);
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — submit → destructive Alert with generic-error copy is visible", async () => {
      const submit = page.getByRole("button", { name: /Create admin and finish setup/i });
      await expect(submit).toBeEnabled();
      await submit.click();
      // Title + body copy from end-user.json:
      //   title: "Setup failed"
      //   body:  "Could not finish setup. Review the form and try again."
      // .first() pins to the alert title node (description repeats the
      // "Setup failed" lemma in the body via "finish setup" — we scope
      // by the full title literal to avoid that match).
      const errorAlert = page.locator("[role='alert']", {
        hasText: /Setup failed/i,
      });
      await expect(errorAlert).toBeVisible({ timeout: 10_000 });
      await expect(errorAlert).toContainText(
        /Could not finish setup\. Review the form and try again\./i,
      );
      // Defensive: the tenant_rename_failed warning copy must NOT be
      // present (would indicate a variant mismatch).
      await expect(
        page.getByText(/Admin created, but the workspace name could not be saved/i),
      ).toHaveCount(0);
      // We do NOT redirect — the wizard stays on /setup.
      expect(page.url()).toMatch(/\/setup(\/|\?|$)/);
    });
  });

  test("warning branch: 201 with warnings:['tenant_rename_failed'] renders non-destructive Alert", async ({
    page,
  }) => {
    await test.step("step 1 — pre-arm 201+warning stub on /api/setup/admin AND delayed /admin nav", async () => {
      await page.route(SETUP_ADMIN_ROUTE, (route) =>
        route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            admin: { email: FIXTURE_EMAIL },
            alreadyCompleted: false,
            warnings: ["tenant_rename_failed"],
          }),
        }),
      );
      // SetupForm.tsx:191-194 sets warningKind THEN calls
      // router.push("/admin"). The push schedules a client-side
      // navigation that fetches /admin (Next.js RSC) and unmounts the
      // wizard once the new page commits. To keep the warning Alert
      // observable, delay any request whose path is the /admin page
      // root (Next.js App Router fetches the RSC payload with
      // `?_rsc=...`). The regex anchors the path component immediately
      // after the origin (port) — `http://localhost:3000/admin?...` —
      // so it does NOT match the API surface `/api/setup/admin` which
      // would otherwise share the `/admin` suffix and starve the
      // SETUP_ADMIN_ROUTE handler.
      await page.route(/^https?:\/\/[^/]+\/admin(\?|$|\/)/, async (route) => {
        // Hold the response for 3s — long enough for the warning Alert
        // assertion to complete. Then abort so we never actually leave
        // /setup (keeps the test wholly focused on the warning Alert,
        // not on /admin's render).
        await new Promise((r) => setTimeout(r, 3000));
        await route.abort();
      });
    });

    await test.step("step 2 — fill the wizard (Identity → Workspace → Review)", async () => {
      await fillWizard(page);
      // Warning copy must NOT pre-render before submit.
      await expect(
        page.getByText(/Admin created, but the workspace name could not be saved/i),
      ).toHaveCount(0);
      // And neither the destructive variant.
      await expect(page.getByText(/Setup failed/i)).toHaveCount(0);
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — submit → non-destructive Alert with rename-failed copy is visible", async () => {
      const submit = page.getByRole("button", { name: /Create admin and finish setup/i });
      await expect(submit).toBeEnabled();
      // Capture the stubbed 201 response so we know the warning state-
      // setter has fired before we assert.
      const responsePromise = page.waitForResponse(
        (res) => res.url().endsWith("/api/setup/admin") && res.request().method() === "POST",
      );
      await submit.click();
      const response = await responsePromise;
      expect(response.status()).toBe(201);

      // The warning Alert renders with role="status" (non-destructive
      // variant — SetupForm.tsx:250). Scope by role + the EN copy.
      const warningAlert = page.locator("[role='status']", {
        hasText: /Admin created, but the workspace name could not be saved/i,
      });
      await expect(warningAlert).toBeVisible({ timeout: 5_000 });
      await expect(warningAlert).toContainText(/You can change it later from the admin panel\./i);
      // Defensive: the destructive variant must NOT be present
      // (would indicate the wizard misclassified the warning as error).
      await expect(page.getByText(/Setup failed/i)).toHaveCount(0);
    });
  });
});
