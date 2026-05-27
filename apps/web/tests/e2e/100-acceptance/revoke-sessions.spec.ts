// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-01-c — Long-form acceptance: per-row Revoke + bulk
// "Revoke all other sessions" on /app/account SessionsTable. Closes
// BUG-55-SESSION-REVOKE-UNTESTED + 2 MISSING UCs:
//
//   UC-SESSIONS-REVOKE-ONE-CLICK — per-row Revoke click drives
//     authClient.revokeSession({ token }) → POST /api/auth/revoke-session,
//     the specific row vanishes from the table on re-fetch.
//   UC-SESSIONS-REVOKE-OTHERS-CLICK — bulk header button drives
//     authClient.revokeOtherSessions() → POST /api/auth/revoke-other-sessions,
//     every non-current row vanishes; current session keeps working.
//
// Slim-only by design (mirrors apps/web/tests/e2e/100-acceptance/
// full-flow.spec.ts + delete-account.spec.ts) — production-equivalent
// routing is covered by the Phase 53 u1..u13 sweep + CJM suite.
//
// Fixture-user isolation rationale — we deliberately do NOT inherit the
// per-worker alice+N pool used elsewhere in this suite. Reasons:
//   1. Bulk "revoke all other sessions" would orphan the storageState
//      cookie of any concurrent spec that signed in as the same pooled
//      user — every downstream spec would start signed-out. This spec
//      uses its OWN dedicated email (`alice+55@test.local`) so the
//      per-row + bulk revokes only ever affect this spec's contexts.
//   2. Slim caps workers at 1 (playwright.config.ts:76) so alice+55 is
//      far outside any plausible per-worker collision range (would need
//      55+ workers to collide — operational impossibility).
//   3. Self-contained: spec does NOT import the per-worker auth pool.
//      The sign-up + verify legs use the same UI path as full-flow.
//
// User row persists across runs (only resource rows are cleaned by
// `clearAllData`). The first run sign-ups + verifies; subsequent runs
// detect USER_ALREADY_EXISTS on sign-up and skip the verify hop.
//
// Mailpit access lives behind apps/web/tests/e2e/support/mailpit.ts
// (Phase 54 / Plan 54-01) — the spec is forbidden from re-implementing
// inline mailpit polling.
//
// Browser-side error invariant: every step ends with a call to
// `expectNoBrowserErrors(page)` on the PRIMARY page. Secondary /
// tertiary browser contexts do not carry diagnostics (the assertion
// surface is the primary user's view).

import { type BrowserContext, test as base, expect } from "@playwright/test";
import {
  allowBrowserErrors,
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
} from "../support/browser-diagnostics.js";
import { fetchVerificationLink } from "../support/mailpit.js";

const WEB_BASE = "http://localhost:3000";
const FIXTURE_EMAIL = "alice+55@test.local";
const FIXTURE_PASSWORD = "Revoke55!#StrongTest";

// Override the per-worker fixture storageState — this spec MUST start
// signed-out and provisions its own dedicated user via the UI.
const test = base.extend({});
test.use({ storageState: { cookies: [], origins: [] } });

// Wipe ALL Better Auth sessions for the fixture user. alice+55 persists
// across runs (the user row is never deleted between runs; only resource
// rows are cleaned by `clearAllData`), and so do its session rows —
// without this cleanup, every subsequent run starts with 3+ leftover
// sessions and the "exactly two rows" assertions in step 4 fail with
// count=4/5/.... Mirrors the DB-direct cleanup pattern from
// u5-account.spec.ts:28-64. Runs over `docker compose exec postgres
// psql` — same channel as fixtures/auth.ts:121-137.
async function wipeFixtureUserSessions(): Promise<void> {
  const sql =
    `DELETE FROM sessions WHERE user_id = ` +
    `(SELECT id FROM users WHERE email = '${FIXTURE_EMAIL}')`;
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
    // best-effort; the spec body will surface real assertion failures
  });
}

test.describe("@phase55-acceptance @long-form — revoke sessions round-trip (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // eslint-disable-next-line prettier/prettier -- single-line skip required by Plan 55-01-c done-gate grep
    // SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-01-c acceptance suite runs against slim topology only — traefik path covered by Phase 53 sweep + CJM suite",
    );
    await wipeFixtureUserSessions();
    await attachBrowserDiagnostics(page);
    // Multi-navigation flow (sign-up -> /sign-in -> /app/account ->
    // revoke -> reload -> revoke-all -> /app) cancels in-flight Next.js
    // chunk prefetches that surface as
    // `GET /_next/static/chunks/<hash>.js -> net::ERR_ABORTED`. Same
    // framework-level abort class as the `_rsc=…` entries already in
    // DEFAULT_ALLOWLIST — not a real bug.
    allowBrowserErrors(page, [
      /GET [^ ]+\/_next\/static\/chunks\/[^ ]+ → FAILED: net::ERR_ABORTED/,
    ]);
  });

  test("revokes a specific session, then all other sessions, current session stays valid — zero browser errors", async ({
    browser,
    page,
    context,
  }) => {
    await test.step("step 1 — provision + sign in alice+55 idempotently via web UI", async () => {
      // Strategy: try sign-in first. If alice+55 exists AND is verified
      // (from a prior run), sign-in succeeds → skip sign-up. If sign-in
      // fails (user missing OR unverified), fall back to the sign-up +
      // mailpit-verify path. This handles both first-ever runs and any
      // subsequent run where the user row persisted in postgres.
      const cursor = new Date();
      await page.goto(`${WEB_BASE}/sign-in`);
      await page.getByLabel(/^Email/i).fill(FIXTURE_EMAIL);
      await page.getByLabel(/^Password/i).fill(FIXTURE_PASSWORD);
      await page.getByRole("button", { name: /sign in|log in/i }).click();
      const signedIn = await page
        .waitForURL(/\/app(\/.*)?$/, { timeout: 8_000 })
        .then(() => true)
        .catch(() => false);

      if (!signedIn) {
        // Fresh-user path: navigate to /sign-up, register, fetch the
        // verification link from mailpit, then come back to /sign-in.
        await page.goto(`${WEB_BASE}/sign-up`);
        await expect(page).toHaveURL(/\/sign-up$/);
        await page.getByLabel(/^Name/i).fill("Alice55 Revoke");
        await page.getByLabel(/^Email/i).fill(FIXTURE_EMAIL);
        await page.getByLabel(/^Password/i).fill(FIXTURE_PASSWORD);
        const confirm = page.getByLabel(/Confirm password/i);
        if (await confirm.isVisible().catch(() => false)) {
          await confirm.fill(FIXTURE_PASSWORD);
        }
        const terms = page.getByRole("checkbox", { name: /terms/i });
        if (await terms.isVisible().catch(() => false)) {
          await terms.check();
        }
        await page.getByRole("button", { name: /sign up|create account|register/i }).click();
        await page.waitForLoadState("networkidle");

        const verifyLink = await fetchVerificationLink(FIXTURE_EMAIL, {
          since: cursor,
          timeoutMs: 15_000,
        });
        expect(verifyLink).toMatch(/token=/);
        const verifyRes = await context.request.get(verifyLink);
        expect([200, 302, 303]).toContain(verifyRes.status());

        // Now sign-in for real.
        await page.goto(`${WEB_BASE}/sign-in`);
        await page.getByLabel(/^Email/i).fill(FIXTURE_EMAIL);
        await page.getByLabel(/^Password/i).fill(FIXTURE_PASSWORD);
        await page.getByRole("button", { name: /sign in|log in/i }).click();
        await page.waitForURL(/\/app(\/.*)?$/, { timeout: 15_000 });
      }

      await expect(page).toHaveURL(/\/app(\/.*)?$/);
      await page.waitForLoadState("networkidle");

      // Capture primary session token cookie so we can later assert
      // the primary session survived both revoke flows. Cookie is the
      // Better Auth host-scoped jar entry (u5-account.spec.ts:36).
      const cookies = await page.context().cookies();
      const tokenCookie = cookies.find((c) => c.name === "openwhispr.session_token");
      expect(tokenCookie, "primary session_token cookie must be present").toBeTruthy();
      const primarySessionToken = decodeURIComponent(tokenCookie?.value ?? "").split(".")[0] ?? "";
      expect(primarySessionToken.length).toBeGreaterThan(0);
      expectNoBrowserErrors(page);
    });

    // Spin up the SECOND context (creates a second Better Auth session row).
    const secondCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    // `thirdCtx` is assigned inside a `test.step` callback in step 6;
    // TS can't see through the callback to narrow `null`, so we use a
    // single-element ref to carry it across the linear control flow
    // without resorting to `as` suppressions (CLAUDE.md DISCIPLINE-12).
    const thirdCtxRef: { value: BrowserContext | null } = { value: null };

    try {
      await test.step("step 3 — sign in same user on a second browser context", async () => {
        const secondPage = await secondCtx.newPage();
        await secondPage.goto(`${WEB_BASE}/sign-in`);
        await secondPage.getByLabel(/^Email/i).fill(FIXTURE_EMAIL);
        await secondPage.getByLabel(/^Password/i).fill(FIXTURE_PASSWORD);
        await secondPage.getByRole("button", { name: /sign in|log in/i }).click();
        await secondPage.waitForURL(/\/app(\/.*)?$/, { timeout: 15_000 });
        await secondPage.close();
        expectNoBrowserErrors(page);
      });

      await test.step("step 4 — primary navigates to /app/account, sees TWO session rows", async () => {
        await page.goto(`${WEB_BASE}/app/account`);
        await expect(page).toHaveURL(/\/app\/account$/);
        // Header row + 2 data rows = 3 rows total. The auto-retrying
        // matcher polls up to 10s while list-sessions GET resolves and
        // TanStack Query renders.
        await expect(page.getByRole("row")).toHaveCount(3, { timeout: 10_000 });
        await expect(page.getByTestId("session-row-this-device")).toBeVisible();
        expectNoBrowserErrors(page);
      });

      await test.step("step 5 — click Revoke on the non-current row", async () => {
        // The current row is the one carrying the
        // `session-row-this-device` badge. Filter rows that do NOT
        // contain that badge AND DO contain a Revoke button. Use
        // `first()` defensively — slim caps at 1 worker so only one
        // such row exists at this point, but order is not guaranteed.
        const otherRow = page
          .getByRole("row")
          .filter({ hasNot: page.getByTestId("session-row-this-device") })
          .filter({ has: page.getByRole("button", { name: /^Revoke$/i }) })
          .first();
        await otherRow.getByRole("button", { name: /^Revoke$/i }).click();

        // After invalidation the table re-fetches → 1 data row left
        // (header + 1). hasOthers (SessionsTable.tsx:147) flips false
        // → the bulk "Revoke all other sessions" button disappears.
        await expect(page.getByRole("row")).toHaveCount(2, { timeout: 10_000 });
        await expect(page.getByRole("button", { name: /Revoke all other sessions/i })).toHaveCount(
          0,
        );
        // Current row still bears the "this device" badge.
        await expect(page.getByTestId("session-row-this-device")).toBeVisible();
        expectNoBrowserErrors(page);
      });

      await test.step("step 6 — sign in same user on a THIRD browser context to re-add a non-current row", async () => {
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
        thirdCtxRef.value = ctx;
        const thirdPage = await ctx.newPage();
        await thirdPage.goto(`${WEB_BASE}/sign-in`);
        await thirdPage.getByLabel(/^Email/i).fill(FIXTURE_EMAIL);
        await thirdPage.getByLabel(/^Password/i).fill(FIXTURE_PASSWORD);
        await thirdPage.getByRole("button", { name: /sign in|log in/i }).click();
        await thirdPage.waitForURL(/\/app(\/.*)?$/, { timeout: 15_000 });
        await thirdPage.close();
        expectNoBrowserErrors(page);
      });

      await test.step("step 7 — primary reloads, clicks 'Revoke all other sessions'", async () => {
        await page.reload();
        await page.waitForLoadState("networkidle");
        // 1 header + 2 data rows (current + the new third-context row).
        await expect(page.getByRole("row")).toHaveCount(3, { timeout: 10_000 });
        await page.getByRole("button", { name: /Revoke all other sessions/i }).click();
        // After invalidation: only current row remains; bulk button gone.
        await expect(page.getByRole("row")).toHaveCount(2, { timeout: 10_000 });
        await expect(page.getByRole("button", { name: /Revoke all other sessions/i })).toHaveCount(
          0,
        );
        await expect(page.getByTestId("session-row-this-device")).toBeVisible();
        expectNoBrowserErrors(page);
      });

      await test.step("step 8 — primary session still authenticated on /app", async () => {
        await page.goto(`${WEB_BASE}/app`);
        await page.waitForLoadState("networkidle");
        await expect(page).toHaveURL(/\/app$/);
        // KPI card is the stable signed-in landmark (mirror full-flow.spec.ts:120).
        await expect(page.getByTestId("kpi-words-used")).toBeVisible();
        expectNoBrowserErrors(page);
      });
    } finally {
      // step 9 — cleanup. Always close orphan contexts even on assertion
      // failure (mirrors u5-account.spec.ts:107 + the testcontainers
      // cleanup discipline from MEMORY.md). secondCtx + thirdCtx don't
      // hold live sessions anymore (revoked above) but their cookie
      // jars + storage hold heap memory until disposed.
      await secondCtx.close().catch(() => {});
      if (thirdCtxRef.value !== null) await thirdCtxRef.value.close().catch(() => {});
    }
  });
});
