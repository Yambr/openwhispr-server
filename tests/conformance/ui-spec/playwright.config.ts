// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 05b / Task 2 — Playwright config for the UICONF-05 axe
// conformance lane.
//
// This config DOES NOT boot the compose stack via Playwright `webServer`.
// The axe spec opens/closes the stack via `bootStack()` / `tearStack()` from
// `tests/e2e-cjm/support/compose-harness.ts` in `beforeAll` / `afterAll`
// (Phase 13 primitive reuse, D-22 + plan threat T-12.05b-03 binding — one
// boot per suite, not per test, no double-boot).
//
// D-22 (Phase 12 carry-over of Phase 13 D-12): retry-on-flake is BANNED.
// `retries: 0` is non-negotiable — if a route flakes under axe, fix the
// underlying production component, do NOT mask via retry.
//
// Chromium-only: axe-core's contrast / focus-visible / landmark-unique
// rules require a real browser-rendered DOM (happy-dom cannot honestly
// evaluate them — CONTEXT D-19 binding).
//
// baseURL points at the Traefik-fronted host published by the e2e-cjm
// compose project (`https://app.localhost` with self-signed cert). This
// matches `tests/e2e-cjm/playwright.config.ts` so a single hosts-file +
// trust-store setup serves both suites.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./",
  testMatch: "*.spec.ts",
  // D-22 invariant: NEVER raise retries above 0. The axe lane is a
  // deterministic conformance gate; flakes are real defects.
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "https://app.localhost",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Resolve the Traefik vhosts (`*.localhost`) to 127.0.0.1 WITHOUT
        // requiring sudo /etc/hosts edits on the developer machine. macOS
        // does not auto-resolve `.localhost` TLDs (unlike Linux nss-mdns);
        // CI explicitly writes /etc/hosts, but locally we route via
        // Chromium's --host-resolver-rules launch arg. This keeps the same
        // baseURL (`https://app.localhost`) across both lanes.
        launchOptions: {
          args: [
            "--host-resolver-rules=MAP app.localhost 127.0.0.1, MAP api.localhost 127.0.0.1, MAP auth.localhost 127.0.0.1",
          ],
        },
      },
    },
  ],
});
