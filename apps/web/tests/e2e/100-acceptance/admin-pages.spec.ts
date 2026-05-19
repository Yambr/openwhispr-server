// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-18 — Admin pages happy-path acceptance spec.
//
// Closes the last MISSING UCs from RESEARCH.md §"/admin",
// "/admin/observability", "/admin/config":
//
//   UC-ADMIN-INDEX-RENDER         — /admin renders title + lede +
//                                    read-only status alert + 2 cards
//   UC-ADMIN-SIDEBAR-NAV          — sidebar nav links route to
//                                    /admin/observability + /admin/config
//   UC-ADMIN-OBSERVABILITY-RENDER — /admin/observability renders title
//                                    (env-missing alert under slim is
//                                    the expected branch — no Grafana
//                                    var in the OSS quickstart base)
//   UC-ADMIN-CONFIG-RENDER        — /admin/config renders STT +
//                                    note-recording cards
//
// Admin model (constitutional, global memory feedback_admin_via_onboarding):
//   - Admin = regular user with users.role='admin'.
//   - First user completing the /setup wizard becomes admin (Phase 12 /
//     Plan 12-03 POST /api/setup/admin grants role=admin to that user).
//   - NO basic-auth, NO Traefik gate, NO separate admin login.
//   - apps/web/src/app/(admin)/layout.tsx calls checkAdminAccess(session)
//     which requires session.user.role === 'admin'.
//
// Fixture role grant: the per-worker fixture
// (apps/web/tests/e2e/fixtures/auth.ts patchEmailVerified) already issues
// `UPDATE users SET role='admin'` on alice+<workerIndex>@test.local at
// global-setup time (Phase 53 / Plan 53-25). The spec therefore reuses
// the per-worker storageState — the signed-in user IS an admin, and the
// (admin) layout's role gate passes without any additional bootstrap.
//
// Slim-only by design (mirrors other 100-acceptance specs) — production-
// equivalent routing under Traefik is covered by the Phase 53 a2/a3
// sweep + CJM suite.
//
// Browser-error invariant: every step ends with expectNoBrowserErrors().

import { expect, test } from "../fixtures/auth.js";
import { expectNoBrowserErrors } from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";

test.describe("@phase55-acceptance @long-form — admin pages happy path (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // eslint-disable-next-line prettier/prettier -- single-line skip required by Plan 55-18 done-gate grep
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-18 acceptance suite runs against slim topology only — traefik path covered by Phase 53 a2/a3 sweep + CJM suite",
    );
    // Probe — the per-worker fixture must have provisioned an admin
    // session. If the storageState cookie jar is empty the (admin)
    // layout 403s and every assertion below fails with a confusing
    // 'Forbidden' surface. Surfacing the empty-jar branch here makes
    // the failure mode unambiguous.
    const cookies = await page.context().cookies();
    const hasSession = cookies.some((c) => c.name === "openwhispr.session_token");
    expect(hasSession, "per-worker admin fixture must have signed-in storageState").toBe(true);
  });

  test("admin index, sidebar nav, observability, and config render for admin-role user — zero browser errors", async ({
    page,
  }) => {
    await test.step("UC-ADMIN-INDEX-RENDER — /admin renders title, lede, read-only alert, 2 cards", async () => {
      await page.goto(`${WEB_BASE}/admin`);
      await expect(page).toHaveURL(/\/admin$/);

      // page-head — title + lede (i18n keys admin.index.title.heading.text +
      // admin.index.lede.body.text from apps/web/src/locales/en/admin.json).
      await expect(page.getByRole("heading", { level: 1, name: /^Configuration$/ })).toBeVisible();
      await expect(
        page.getByText(/Server-side configuration for speech-to-text and note recording/i),
      ).toBeVisible();

      // Read-only status alert.
      await expect(page.getByRole("status").filter({ hasText: /^Read-only$/ })).toBeVisible();
      await expect(
        page.getByText(/Edits require restarting the api container with updated env\./i),
      ).toBeVisible();

      // 2-card grid — STT + Note recording (titles + endpoint labels).
      await expect(page.getByText(/^Speech-to-text$/)).toBeVisible();
      await expect(page.getByText(/GET \/api\/stt-config/).first()).toBeVisible();
      await expect(page.getByText(/^Note recording$/).first()).toBeVisible();
      await expect(page.getByText(/GET \/api\/note-recording-config/).first()).toBeVisible();

      expectNoBrowserErrors(page);
    });

    await test.step("UC-ADMIN-SIDEBAR-NAV — sidebar has Observability + Configuration links", async () => {
      // AdminShell.tsx renders <nav aria-label="Admin"> with two Link
      // entries pointing at /admin/observability + /admin/config.
      const sidebar = page.getByRole("navigation", { name: /^Admin$/ });
      await expect(sidebar).toBeVisible();
      await expect(sidebar.getByRole("link", { name: /^Observability$/ })).toBeVisible();
      await expect(sidebar.getByRole("link", { name: /^Configuration$/ })).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("UC-ADMIN-OBSERVABILITY-RENDER — sidebar click routes to /admin/observability", async () => {
      await page
        .getByRole("navigation", { name: /^Admin$/ })
        .getByRole("link", { name: /^Observability$/ })
        .click();
      await page.waitForURL(/\/admin\/observability$/);

      // Title is always rendered. Slim does NOT set
      // NEXT_PUBLIC_GRAFANA_BASE_URL → the screen short-circuits to
      // the env-missing alert branch (ObservabilityClient.tsx:100-117).
      // Both the title and the env-missing alert are first-class
      // observable truths of the route under slim.
      await expect(page.getByRole("heading", { level: 1, name: /^Observability$/ })).toBeVisible();
      await expect(page.getByText(/Grafana endpoint not configured/i).first()).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("UC-ADMIN-CONFIG-RENDER — sidebar click routes to /admin/config, STT + note-recording cards render", async () => {
      await page
        .getByRole("navigation", { name: /^Admin$/ })
        .getByRole("link", { name: /^Configuration$/ })
        .click();
      await page.waitForURL(/\/admin\/config$/);

      // Title rendered by ConfigClient regardless of fetch state.
      await expect(page.getByRole("heading", { level: 1, name: /^Configuration$/ })).toBeVisible();
      await expect(
        page.getByText(/Server-side STT and note-recording defaults\. Read-only\./i),
      ).toBeVisible();

      // Refresh + Docs buttons in the header (proves header rendered).
      await expect(page.getByRole("button", { name: /^Refresh$/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Docs: how to override/i })).toBeVisible();

      // Both cards render their titles (CardTitle text) + endpoint
      // labels (CardDescription text). Endpoint labels are the
      // canonical i18n strings from admin.config.{stt,note}.endpoint.label.
      await expect(page.getByText(/^STT config$/)).toBeVisible();
      await expect(page.getByText(/GET \/api\/stt-config/).first()).toBeVisible();
      await expect(page.getByText(/^Note recording$/).first()).toBeVisible();
      await expect(page.getByText(/GET \/api\/note-recording-config/).first()).toBeVisible();

      // Either the table populated (200 from /api/stt-config) OR the
      // inline error message is visible — both are valid GREEN states
      // for "screen rendered for an admin-role user". The card SHELL is
      // the load-bearing assertion; the row contents are covered by the
      // vitest unit suite (apps/web/src/components/screens/admin/
      // __tests__/ConfigClient.test.tsx). Wait for at least one of the
      // two terminal states to surface.
      await expect(async () => {
        const tableVisible = await page
          .getByRole("cell", { name: /^Default model$/ })
          .isVisible()
          .catch(() => false);
        const errorVisible = await page
          .getByText(/Retry, or check the api container logs/i)
          .first()
          .isVisible()
          .catch(() => false);
        expect(tableVisible || errorVisible).toBe(true);
      }).toPass({ timeout: 10_000 });

      expectNoBrowserErrors(page);
    });
  });
});
