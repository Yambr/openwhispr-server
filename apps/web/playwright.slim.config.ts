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

export default defineConfig({
  testDir: "./tests/e2e",
  // Only the Phase 53 sentinel runs under this config. The other 21
  // specs assume Traefik host-split and live under the main config.
  testMatch: ["p53-*.spec.ts"],
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
