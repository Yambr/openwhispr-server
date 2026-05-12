// Phase 07.1 / Plan 13 — Cross-screen smoke (WEB-IMPL-03 closure).
//
// One happy-path flow that walks the signed-in user through five primary
// screens against the real docker-compose stack, then signs out. The intent
// is to catch end-to-end regressions where route guards, layout chrome, or
// shared providers break across screen boundaries — not exhaustive state
// coverage (per-screen state matrix lives in u1..u13).
//
// D-TEST-3 compliance: no internal-logic mocks. Real Better Auth session,
// real /api/notes, /api/transcriptions, /api/conversations endpoints, real
// Postgres state. Seeded resources are torn down before the spec runs.

import { expect, fixtureEmail, test } from "./fixtures/auth.js";
import { bindToContext } from "./fixtures/seed.js";

test.describe("99 — cross-screen smoke (Phase 07.1 / Plan 13)", () => {
  // Plan 13.1 — auth provisioned by global-setup.ts; per-worker storageState
  // applied via the auth-extended `test`. Only data state is reset here.
  test.beforeEach(async ({ context }) => {
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test("sign-in → /app → notes → transcriptions → conversations → account → sign-out", async ({
    page,
    context,
  }, info) => {
    const seed = bindToContext(context);

    // Seed one resource per list so the success cards don't collapse to empty.
    await seed.seedNotes({ count: 1, title: "Smoke note" });
    await seed.seedTranscriptions({ count: 1, text: "Smoke transcription text" });
    await seed.seedConversations({ count: 1, title: "Smoke conversation" });

    // 1) /app dashboard — Words used KPI card present (U4).
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByTestId("kpi-words-used")).toBeVisible();

    // 2) /app/transcriptions — list renders the seeded row.
    await page.goto("/app/transcriptions");
    await expect(page).toHaveURL(/\/app\/transcriptions$/);
    await expect(page.getByText(/Smoke transcription/i).first()).toBeVisible();

    // 3) /app/notes — list renders the seeded row.
    await page.goto("/app/notes");
    await expect(page).toHaveURL(/\/app\/notes$/);
    await expect(page.getByText(/Smoke note/i).first()).toBeVisible();

    // 4) /app/conversations — list renders the seeded row.
    await page.goto("/app/conversations");
    await expect(page).toHaveURL(/\/app\/conversations$/);
    await expect(page.getByText(/Smoke conversation/i).first()).toBeVisible();

    // 5) /app/account — profile card shows the fixture email.
    await page.goto("/app/account");
    await expect(page).toHaveURL(/\/app\/account$/);
    await expect(page.getByText(fixtureEmail(info.parallelIndex))).toBeVisible();

    // 6) Sign out — Better Auth /api/auth/sign-out clears the session cookie.
    const baseUrl = process.env.BASE_URL ?? "https://api.localhost";
    const signOut = await page.request.post(`${baseUrl}/api/auth/sign-out`, {
      headers: { "content-type": "application/json", origin: baseUrl },
      data: {},
      ignoreHTTPSErrors: true,
    });
    expect(signOut.ok()).toBe(true);

    // 7) Route guard — a protected page now redirects to /sign-in (middleware
    //    307 → /sign-in?from=/app/account per Phase 07.1 / Plan 05).
    await page.goto("/app/account");
    await expect(page).toHaveURL(/\/sign-in(\?|$)/);
  });
});
