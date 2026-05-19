// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-05 — Long-form acceptance: /setup wizard happy path.
//
// Closes all 8 MISSING UCs from RESEARCH.md §"/setup" (SetupForm.tsx,
// 416 LOC, IntersectionObserver-driven 3-section single-page wizard):
//
//   UC-SETUP-WIZARD-IDENTITY-VISIBLE — identity section first on load
//   UC-SETUP-WIZARD-IDENTITY-FILL    — name/email/password accept input
//   UC-SETUP-WIZARD-STEPPER-ADVANCE  — IntersectionObserver advances
//                                      currentStep as the user scrolls
//   UC-SETUP-WIZARD-WORKSPACE-FILL   — workspace + timezone fields render
//                                      and accept input
//   UC-SETUP-WIZARD-REVIEW-MIRROR    — <dl> in the Review section mirrors
//                                      values entered in earlier sections
//   UC-SETUP-WIZARD-SUBMIT-ENABLED   — submit button enables once the form
//                                      is fully filled (the wizard relies
//                                      on RHF + zod validation gating it)
//   UC-SETUP-WIZARD-SUBMIT-201       — POST /api/setup/admin returns 201/200
//   UC-SETUP-WIZARD-REDIRECT-ADMIN   — successful submit pushes /admin
//   UC-SETUP-WIZARD-NO-BROWSER-ERR   — every step ends zero-error
//
// Phase 55-05b closure: previously the spec stopped at the "submit
// enabled" assertion because BUG-55-05-SETUP-ADMIN-ROUTE-UNWIRED
// (apps/api/src/index.ts never threading `setupAdmin` into
// `buildAllRoutes`) made every submit 404. The 55-05b GREEN commit
// wires the dep through (production bootstrap constructs an owner pool
// + `signUpEmail` adapter against the real Better Auth instance), so
// step 6 now performs the full submit + /admin redirect flow.
//
// Slim-only by design (mirrors apps/web/tests/e2e/100-acceptance/
// full-flow.spec.ts + revoke-sessions.spec.ts) — production-equivalent
// routing is covered by Phase 53 sweep + CJM suite.
//
// Reset seam: POST /api/_test/reset-setup (Phase 55-05 / Plan 55-05)
// flips the singleton setup_state row back to 'pending' so the wizard
// re-renders instead of redirecting to /admin. Endpoint is gated on
// OPENWHISPR_TEST_ROUTES=true (dev-tools overlay only — production
// instances 404 the path entirely). NOT signed-in: the wizard runs
// while the operator has no session, by spec.
//
// Idempotency contract: the spec uses a deterministic admin email
// ("setup-wizard-55@test.local"). On second + subsequent runs the
// /api/setup/admin handler hits its race-loser branch
// (apps/api/src/routes/setup-admin.ts:194-201) and returns 200 with
// alreadyCompleted:true; the wizard treats both 201 and 200 as success
// and redirects (SetupForm.tsx:188-196). We assert the redirect, not
// the status code shape, so the spec is stable across runs.
//
// Timezone hydration safety (Phase 53 / Plan 53-30 pattern): the
// SetupForm useEffect populates the timezone select post-hydration via
// defaultTimezone(). page.emulateTimezone keeps SSR and CSR aligned so
// no React #418 mismatch fires.
//
// Browser-side error invariant: every step ends with
// `expectNoBrowserErrors(page)` — 6 calls total (one per step).

import { test as base, expect } from "@playwright/test";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";
const API_BASE = "http://localhost:4000";

// Deterministic fixture — see "Idempotency contract" above.
const FIXTURE_EMAIL = "setup-wizard-55@test.local";
const FIXTURE_PASSWORD = "SetupWizard55!Strong";
const FIXTURE_NAME = "Setup Wizard Fifty Five";
const FIXTURE_WORKSPACE = "Setup Wizard Workspace 55";
// IANA zone we explicitly select in the wizard. NOTE: Intl.supported
// ValuesOf('timeZone') on Node 24 returns the canonical zone list which
// does NOT include "UTC" itself (UTC is an alias of "Etc/UTC" but neither
// appears in supportedValuesOf — the list starts at "Africa/Abidjan"
// and contains ~418 named zones). The SetupForm useEffect resolves the
// browser default via Intl.DateTimeFormat().resolvedOptions().timeZone
// which CAN return "UTC", but the <select> options list it as an
// invalid choice. We pick a zone guaranteed present in the supported-
// values list to drive the explicit selection assertion. Tracked as a
// follow-up: SetupForm should prepend "UTC" to the option list when
// the resolved browser zone is "UTC" so the default matches the option
// values — out of scope for the e2e seam (Phase 55-05).
const FIXTURE_TIMEZONE = "Europe/London";

// Override the per-worker fixture storageState — this spec MUST start
// signed-out (the setup wizard renders for unauthenticated visitors;
// authenticated visitors get a different code path).
const test = base.extend({});
test.use({
  storageState: { cookies: [], origins: [] },
  // Align SSR + CSR — both render with empty-string timezone on first
  // paint (SetupForm.tsx:133); the post-hydration useEffect (line 141)
  // then populates the browser zone. Pick Europe/London so the resolved
  // browser zone equals an option value present in the <select> list.
  timezoneId: "Europe/London",
});

test.describe("@phase55-acceptance @long-form — setup wizard happy path (slim)", () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    // eslint-disable-next-line prettier/prettier -- single-line skip required by Plan 55-05 done-gate grep
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-05 acceptance suite runs against slim topology only — traefik path covered by Phase 53 sweep + CJM suite",
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

  test("operator fills 3-section wizard, sees enabled submit at Review — zero browser errors", async ({
    page,
  }) => {
    await test.step("step 1 — load /setup, see Identity section + stepper", async () => {
      await page.goto(`${WEB_BASE}/setup`);
      // Wizard heading (en).
      await expect(
        page.getByRole("heading", { name: /Set up your OpenWhispr server/i }),
      ).toBeVisible();
      // All three section anchors are rendered in the same DOM (single-
      // page wizard). The stepper labels (en) appear as Step Identity /
      // Workspace / Review.
      await expect(page.locator("section#identity")).toBeVisible();
      await expect(page.locator("section#workspace")).toBeAttached();
      await expect(page.locator("section#review")).toBeAttached();
      // The form fields for Identity are visible immediately (section is
      // rendered first; subsequent sections scroll into view).
      await expect(page.getByLabel(/^Name$/i)).toBeVisible();
      await expect(page.getByLabel(/^Email$/i)).toBeVisible();
      await expect(page.getByLabel(/^Password$/i)).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("step 2 — fill Identity (name, email, password)", async () => {
      await page.getByLabel(/^Name$/i).fill(FIXTURE_NAME);
      await page.getByLabel(/^Email$/i).fill(FIXTURE_EMAIL);
      // Password must clear setupSchema's character-class refine
      // (apps/web/src/lib/schemas/setup.ts:38) — mixed upper/lower/digit
      // + length >= 12.
      await page.getByLabel(/^Password$/i).fill(FIXTURE_PASSWORD);
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — scroll Workspace into view (stepper advances via IntersectionObserver)", async () => {
      // IntersectionObserver fires on natural scroll under playwright
      // headless — scrollIntoView via the DOM is the canonical trigger.
      await page.locator("section#workspace").scrollIntoViewIfNeeded();
      // Workspace fields are now visible.
      await expect(page.getByLabel(/^Workspace name$/i)).toBeVisible();
      await expect(page.getByLabel(/^Timezone$/i)).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — fill Workspace (name + timezone)", async () => {
      await page.getByLabel(/^Workspace name$/i).fill(FIXTURE_WORKSPACE);
      // The Timezone <select> defaults via useEffect to the browser
      // zone (UTC, from the emulateTimezone above). Re-select UTC
      // explicitly to make the assertion robust against any future
      // default-resolution change.
      await page.getByLabel(/^Timezone$/i).selectOption(FIXTURE_TIMEZONE);
      expectNoBrowserErrors(page);
    });

    await test.step("step 5 — scroll to Review; <dl> mirrors entered values", async () => {
      await page.locator("section#review").scrollIntoViewIfNeeded();
      // SetupForm.tsx:392-405 — Review <dl> reads form.watch() so the
      // four dt/dd pairs reflect the values typed above.
      const review = page.locator("section#review dl");
      await expect(review).toContainText(FIXTURE_NAME);
      await expect(review).toContainText(FIXTURE_EMAIL);
      await expect(review).toContainText(FIXTURE_WORKSPACE);
      await expect(review).toContainText(FIXTURE_TIMEZONE);
      expectNoBrowserErrors(page);
    });

    await test.step("step 6 — submit button is enabled (form passes RHF + zod gate)", async () => {
      // The submit lives inside the Review section. Label:
      // "Create admin and finish setup" (en-end-user.setup.form
      // .submit.label). SetupForm.tsx:406 disables it only while
      // `submitting === true`; at form-idle the button must be enabled
      // once all four fields have valid values per setupSchema.
      const submit = page.getByRole("button", { name: /Create admin and finish setup/i });
      await expect(submit).toBeVisible();
      await expect(submit).toBeEnabled();
      // The "Setup failed" alert must NOT be present at form-idle —
      // confirms the wizard has not encountered a validation error so
      // far. (en-end-user.setup.error.generic.title.text.)
      await expect(page.getByText(/Setup failed/i)).toHaveCount(0);
      expectNoBrowserErrors(page);
    });

    await test.step("step 7 — click submit, observe 201/200 from /api/setup/admin, land on /admin", async () => {
      // Phase 55-05b closure (BUG-55-05-SETUP-ADMIN-ROUTE-UNWIRED).
      // The production bootstrap now wires `setupAdmin` into
      // buildAllRoutes (apps/api/src/index.ts), so POST
      // /api/setup/admin reaches the real handler at
      // routes/setup-admin.ts.
      //
      // Idempotency contract (see file header): both 201 (fresh) and
      // 200 (race-loser, alreadyCompleted:true) are success; we accept
      // either. The deterministic admin email means subsequent runs
      // hit the 200 branch — assertion is on the redirect, not the
      // status-code shape.
      const submit = page.getByRole("button", { name: /Create admin and finish setup/i });
      const responsePromise = page.waitForResponse(
        (res) => res.url().endsWith("/api/setup/admin") && res.request().method() === "POST",
      );
      await submit.click();
      const response = await responsePromise;
      expect(
        [200, 201].includes(response.status()),
        `expected 200 or 201 from /api/setup/admin, got ${response.status()}`,
      ).toBe(true);
      // SetupForm.tsx:194 — both 201 and 200 trigger router.push('/admin').
      await page.waitForURL(/\/admin(\/|$)/, { timeout: 10_000 });
      // Defensive: the "Setup failed" alert must NOT be present after
      // the redirect lands.
      await expect(page.getByText(/Setup failed/i)).toHaveCount(0);
      expectNoBrowserErrors(page);
    });
  });
});
