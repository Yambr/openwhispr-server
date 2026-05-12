// Phase 07.1 / Plan 04 — Playwright config (D-TEST-1, D-TEST-3).
//
// Decisions enforced here:
//   - D-TEST-1 — chromium-only project. Firefox/WebKit deferred; the matrix
//     dimension is "behavior across 4 UI states", not "browser matrix".
//   - D-TEST-3 — baseURL is the Traefik HTTPS endpoint so requests traverse
//     the same routing stack as production. `ignoreHTTPSErrors: true` accepts
//     the self-signed dev cert at compose/traefik/certs/local.crt; CI workflows
//     additionally set NODE_EXTRA_CA_CERTS=compose/traefik/certs/root-ca.crt.
//   - webServer brings up the full docker-compose default profile and waits
//     for /api/health to return 200. `reuseExistingServer: true` so a
//     developer with the stack already running is not double-booted.
//   - CI branch sets webServer=undefined (the workflow brings up compose
//     before invoking playwright).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Plan 13.1 — provisions ONE Better Auth user per worker up front so
  // spec `beforeEach` no longer hits /api/auth/sign-up/email (which was
  // tripping the anti-abuse rate limiter at 57/85 e2e specs in Plan 13).
  // See tests/e2e/global-setup.ts.
  globalSetup: "./tests/e2e/global-setup.ts",
  // Real services per D-TEST-3 share state across tests; default to serial.
  // Per-worker fixtures (auth.ts, seed.ts) are responsible for isolating
  // their own test users. Plans 07+ flip fullyParallel back on per-screen
  // when isolation is proven sufficient.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Workers: 1 in CI; locally use Playwright's default (undefined → auto)
  // expressed as a percentage string so `exactOptionalPropertyTypes` accepts it.
  workers: process.env.CI ? 1 : "50%",
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "https://api.localhost",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  ...(process.env.CI
    ? {}
    : {
        webServer: {
          command: "docker compose --profile default up -d --wait",
          url: "https://api.localhost/api/health",
          ignoreHTTPSErrors: true,
          timeout: 180_000,
          reuseExistingServer: true,
        },
      }),
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
