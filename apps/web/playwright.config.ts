// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 04 — Playwright config (D-TEST-1, D-TEST-3).
// Phase 53 / Plan 53-14 — Universal config with TWO topology projects.
//
// Decisions enforced here:
//   - D-TEST-1 — chromium-only. Firefox/WebKit deferred; the matrix
//     dimension is "behavior across UI states", not "browser matrix".
//   - D-TEST-3 — `traefik` project is the default (production-
//     equivalent routing stack). `slim` project is the OSS-quickstart
//     opt-in for faster local feedback. Specs derive origins from
//     `tests/e2e/support/topology.ts` using the active project's
//     metadata — they are topology-neutral by construction.
//   - webServer launches the topology-appropriate compose chain.
//     `reuseExistingServer: true` so a developer with the stack
//     already up is not double-booted.
//   - CI branch sets webServer=undefined (the workflow brings up
//     compose before invoking playwright).
//
// Invocation:
//   pnpm playwright test                       — runs both projects
//   pnpm playwright test --project=traefik     — host-split only
//   pnpm playwright test --project=slim        — slim-core only
import { defineConfig, devices } from "@playwright/test";

import type { Topology } from "./tests/e2e/support/topology.js";

const TRAEFIK_API = "https://api.localhost";
// SLIM_API kept for documentation parity; specs derive the API origin
// via `getOrigins(testInfo)` from tests/e2e/support/topology.ts which
// embeds the same `http://localhost:4000` per-project metadata.
const _SLIM_API = "http://localhost:4000";
// `baseURL` is the origin Playwright resolves relative URLs against
// in `page.goto("/x")` and `request.get("/x")`. Specs that hit web
// routes (/sign-in, /app/*) need this to point at the WEB origin.
// Under Traefik, web routes resolve via the api.localhost host (the
// ingress maps both /api and /app routes on the same hostname); under
// slim, web is at a different port and the spec must use the WEB host.
const TRAEFIK_WEB = "https://api.localhost";
const SLIM_WEB = "http://localhost:3000";

// `OPENWHISPR_TOPOLOGY` mirrors the active --project for fixtures that
// run outside a TestInfo context (global-setup.ts, module-top auth.ts
// constants, etc.). The config injects it via project metadata; if the
// suite is invoked WITHOUT --project we fall back to traefik per D-TEST-3.
const TRAEFIK_METADATA = { topology: "traefik" as Topology };
const SLIM_METADATA = { topology: "slim" as Topology };

export default defineConfig({
  testDir: "./tests/e2e",
  // Plan 13.1 — provisions ONE Better Auth user per worker up front so
  // spec `beforeEach` no longer hits /api/auth/sign-up/email (which was
  // tripping the anti-abuse rate limiter at 57/85 e2e specs in Plan 13).
  // See tests/e2e/global-setup.ts.
  globalSetup: "./tests/e2e/global-setup.ts",
  // Real services per D-TEST-3 share state across tests; default to serial.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Phase 21 / Plan 21-02 / SR-21.2 — D-12: retry-on-flake is BANNED.
  retries: 0,
  // Phase 53 / Plan 53-19 — slim topology caps workers at 2 to stay
  // under Better Auth's anti-abuse rate limit (~3 parallel sign-ins per
  // IP). Traefik project + CI keep their established limits.
  // Phase 53 / Plan 53-26 — slim topology drops to workers=1.
  // Was workers=2 (53-19 to stay under Better Auth's anti-abuse limit),
  // but cross-worker state interference still produced ~10 specs that
  // pass in isolation and fail under parallel sweep (u5-account,
  // p53-signup-smoke, u6-trx-list, u7-trx-detail). Slim is the OSS
  // quickstart topology — runtime trade-off (~2x slower) for
  // deterministic passes is correct. Traefik project keeps 50%
  // because per-worker fixture users + tighter compose isolation
  // hold under higher parallelism in production-equivalent layout.
  workers: process.env.CI ? 1 : process.env.OPENWHISPR_TOPOLOGY === "slim" ? 1 : "50%",
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : [["html", { open: "never" }], ["list"]],
  // Project-level `use` overrides set baseURL + ignoreHTTPSErrors per
  // topology. Common settings live at the top level.
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Phase 53 / Plan 53-14 — webServer disabled when running under the
  // `slim` project (no Traefik to wait on; the slim sweep assumes
  // `docker compose up -d` was already invoked). The traefik project
  // outside CI re-enables it. CI brings up compose externally on both.
  //
  // BUG-53-50: when the dev-tools overlay is already up (operator ran
  // `make up-with-dev-tools` before invoking playwright), webServer must
  // NOT shell out to `docker compose --profile default up` — that path
  // forgets the dev-tools overlay and rebuilds api/web/litellm without
  // LITELLM_MASTER_KEY / OUTBOUND_ALLOWED_HOSTS / rate-limit disable
  // → litellm goes unhealthy → entire stack vanishes mid-run.
  //
  // The traefik project's webServer is intentionally only useful in CI
  // with a clean checkout. For local dev, set
  // PLAYWRIGHT_SKIP_WEBSERVER=1 OR use `--project=slim` which already
  // skips it. Future Phase 54+ work can wire a smart probe that detects
  // an already-running stack and skips the bootstrap automatically.
  ...(process.env.CI ||
  process.env.OPENWHISPR_TOPOLOGY === "slim" ||
  process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1"
    ? {}
    : {
        webServer: {
          command: "docker compose --profile default up -d --wait",
          url: `${TRAEFIK_API}/api/health`,
          ignoreHTTPSErrors: true,
          timeout: 180_000,
          reuseExistingServer: true,
        },
      }),
  projects: [
    {
      name: "traefik",
      metadata: TRAEFIK_METADATA,
      use: {
        ...devices["Desktop Chrome"],
        // Under Traefik, web + api share api.localhost; baseURL covers
        // both / (web) and /api/* (api) routes.
        baseURL: TRAEFIK_WEB,
        ignoreHTTPSErrors: true,
      },
    },
    {
      name: "slim",
      metadata: SLIM_METADATA,
      use: {
        ...devices["Desktop Chrome"],
        // Under slim-core, baseURL points at the web origin. API calls
        // go through the topology helper (`getOrigins().apiOrigin`)
        // which resolves to http://localhost:4000.
        baseURL: SLIM_WEB,
        ignoreHTTPSErrors: false,
      },
    },
  ],
});
