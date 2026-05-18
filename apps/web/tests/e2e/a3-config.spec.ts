// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 12 — A3 Config view Playwright spec.
//
// Validates the four UI states + axe-core clean for the admin Config view.
//
// Auth model (D-ADMIN-1): /admin/* is gated by Traefik basic-auth, NOT by
// session. We use Playwright `httpCredentials` to attach the Basic header.
//
// Endpoint constraints (D-S1): only existing GET /api/stt-config and
// GET /api/note-recording-config are used by this screen. We mutate
// responses via `page.route(...)` to exercise loading / error states.
import { expect, test } from "./_diagnostics-fixture.js";
import { runAxe } from "./fixtures/axe";

const ADMIN_BASIC_USER = "admin";
const ADMIN_BASIC_PASS = "testpw123";

test.use({
  httpCredentials: { username: ADMIN_BASIC_USER, password: ADMIN_BASIC_PASS },
});

test.describe("A3 — Config view (Phase 07.1 / Plan 12)", () => {
  test("basic-auth header reaches the web container (no 401)", async ({ request }) => {
    const res = await request.get("/admin/config");
    expect(res.status()).not.toBe(401);
    expect(res.status()).toBeLessThan(500);
  });

  test("loading — both queries pending → two Skeleton tables", async ({ page }) => {
    // Stall both endpoints indefinitely.
    await page.route("**/api/stt-config", async () => {
      // never fulfil
      await new Promise(() => undefined);
    });
    await page.route("**/api/note-recording-config", async () => {
      await new Promise(() => undefined);
    });
    await page.goto("/admin/config");
    // The chrome must still appear immediately.
    await expect(page.getByRole("heading", { level: 1, name: /configuration/i })).toBeVisible();
    const skeletons = page.getByTestId("config-skeleton");
    await expect.poll(async () => await skeletons.count()).toBeGreaterThanOrEqual(2);
  });

  test("error — /api/stt-config 500 → destructive Alert + Retry button", async ({ page }) => {
    await page.route("**/api/stt-config", (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ error: "boom" }) }),
    );
    await page.route("**/api/note-recording-config", (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ error: "boom" }) }),
    );
    await page.goto("/admin/config");
    await expect(page.getByText(/could not load configuration/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^retry$/i })).toBeVisible();
  });

  test("success — both Cards + Tables populate from seeded defaults", async ({ page }) => {
    await page.route("**/api/stt-config", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          defaultModel: "whisper-1",
          defaultLanguage: "en",
          availableProviders: ["openai", "groq"],
        }),
      }),
    );
    await page.route("**/api/note-recording-config", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maxDurationSeconds: 3600,
          sampleRateHz: 16000,
          allowedFormats: ["webm", "wav", "mp3"],
          diarizationEnabled: true,
        }),
      }),
    );
    await page.goto("/admin/config");
    await expect(page.getByText("whisper-1")).toBeVisible();
    await expect(page.getByText("16000")).toBeVisible();
    await expect(page.getByText(/webm/i).first()).toBeVisible();
    // D-API4: no env-block.
    await expect(page.getByText(/effective env/i)).toHaveCount(0);
  });

  test("axe-core — no WCAG 2.2 AA violations", async ({ page }) => {
    await page.route("**/api/stt-config", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          defaultModel: "whisper-1",
          defaultLanguage: "en",
          availableProviders: ["openai", "groq"],
        }),
      }),
    );
    await page.route("**/api/note-recording-config", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maxDurationSeconds: 3600,
          sampleRateHz: 16000,
          allowedFormats: ["webm", "wav", "mp3"],
          diarizationEnabled: true,
        }),
      }),
    );
    await page.goto("/admin/config");
    await expect(page.getByText("whisper-1")).toBeVisible();
    await runAxe(page);
  });
});
