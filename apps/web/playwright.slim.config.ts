// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 53 / Plan 53-05 — Playwright config for the slim-core topology
// (no Traefik, no mkcert). Sibling to the main playwright.config.ts
// which targets the Traefik host-split topology (https://api.localhost
// + https://web.localhost). The two configs are intentionally separate
// so a developer running plain `docker compose up` can exercise the
// Phase 53 sentinel without the mkcert / ingress overlay friction.
//
// Operators with the ingress overlay running keep using the main
// playwright.config.ts; Phase 53 sentinels target the http://localhost:
// 3000 + http://localhost:4000 host-port topology.
import { defineConfig, devices } from "@playwright/test";

// Phase 53 / Plan 53-12 — slim-core does NOT have Traefik / mkcert; the
// API is reachable directly at http://localhost:4000. Specs that talk
// to the API directly (seed.ts, global-setup.ts) read `process.env.
// BASE_URL` with a default of `https://api.localhost`. Set it here so
// the slim sweep reaches the correct origin without per-invocation
// shell-prefix incantation.
process.env.BASE_URL ??= "http://localhost:4000";
process.env.WEB_ORIGIN ??= "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  // Phase 53 / Plan 53-03 — sweep specs that do NOT depend on the
  // axe.ts fixture under the slim-core topology. axe.ts uses
  // `import.meta.url` which trips Playwright's CJS loader without the
  // main playwright.config's webServer/globalSetup ESM bootstrap;
  // axe-dependent specs are deferred to a follow-up plan that
  // either backports the ESM loader OR splits axe.ts.
  // Specs included here: 05-auth-middleware, 99-cross-screen-smoke,
  // auth-shell-visual, i18n-russian, p53-signup-smoke.
  // Phase 53 / Plan 53-12 — restrict to specs that exercise the web
  // origin directly. Specs that depend on Traefik host-split (storage
  // state cookies bound to api.localhost, mkcert-only baseURL gates,
  // visual baselines captured under HTTPS) are excluded here and run
  // under the main playwright.config.ts. The slim-config sentinel is
  // p53-signup-smoke; auth-middleware / i18n-russian carry their own
  // origin-derivation logic and tolerate both topologies. The
  // 99-cross-screen-smoke + visual specs are Traefik-only by design;
  // their seed.ts fixture mints storageState tied to api.localhost.
  testMatch: ["05-auth-middleware.spec.ts", "i18n-russian.spec.ts", "p53-signup-smoke.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
