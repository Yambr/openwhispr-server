// Phase 07.1 / Plan 13.1 — Playwright globalSetup hook.
//
// Goal: avoid Better Auth's anti-abuse rate limiter (Plan 13 deviation —
// 57/85 e2e specs failing with HTTP 429 on /api/auth/sign-up because every
// test's `beforeEach` re-provisioned the fixture user). Strategy:
//
//   1. Pre-compute the worker count from PlaywrightTestConfig (capped, see
//      MAX_WORKERS_PROBED) and provision ONE fixture user per worker,
//      serially with ~250ms spacing — well under Better Auth's default
//      window for /api/auth/sign-up/email.
//   2. Sign each user in once and persist the cookie jar to
//      `playwright/.auth/alice-<i>.json` (path produced by
//      `storageStatePath(i)` in fixtures/auth.ts).
//   3. Also write an `empty.json` storageState for specs that must start
//      signed-out (U1 sign-in form, U2 sign-up form, U3 verify-email).
//   4. Spec files import the extended `test` from `fixtures/auth.js`,
//      which overrides Playwright's `storageState` option to resolve to
//      the worker-scoped file. Each test starts with the cookie jar
//      already loaded — no per-test sign-up/sign-in roundtrip needed.
//
// D-TEST-3 / CLAUDE.md compliance: this hook uses the real Better Auth
// endpoints over Traefik — no internal-logic mocks. Only network-boundary
// mitigation is the rate-limit-friendly cadence.
import { writeFileSync } from "node:fs";
import type { FullConfig } from "@playwright/test";
import {
  emptyStorageStatePath,
  ensureStorageStateDir,
  provisionUserOnce,
} from "./fixtures/auth.js";

// Upper bound on workers we'll pre-provision. Local dev defaults to "50%"
// of cores which can exceed 8 on developer machines; we pin a generous
// ceiling so we never silently leave a worker without a storageState.
const MAX_WORKERS_PROBED = 16;

function resolveWorkerCount(config: FullConfig): number {
  // FullConfig.workers is the *effective* worker count after Playwright
  // resolves percentages and project overrides — exactly what we need.
  const raw = config.workers;
  if (typeof raw === "number" && raw > 0) {
    return Math.min(raw, MAX_WORKERS_PROBED);
  }
  return MAX_WORKERS_PROBED;
}

async function provisionWithSpacing(workerCount: number): Promise<void> {
  for (let i = 0; i < workerCount; i++) {
    // Serial with spacing keeps us under any per-IP rate limit on
    // /api/auth/sign-up/email (Better Auth default + project override
    // in apps/api/src/auth.ts).
    const email = await provisionUserOnce(i);
    // biome-ignore lint/suspicious/noConsole: globalSetup has no logger DI; console is the canonical sink for Playwright setup progress.
    console.log(`[global-setup] provisioned worker ${i} user=${email}`);
    if (i < workerCount - 1) {
      // 1500ms — Better Auth's default sign-in window is 10s/3 attempts
      // and sign-up is even tighter. 1.5s spacing keeps us under the
      // per-IP budget even if the previous run left counters warm.
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

function writeEmptyStorageState(): void {
  // Minimal valid Playwright storageState — no cookies, no origins. Specs
  // that exercise the sign-in / sign-up / verify-email surfaces opt into
  // this via `test.use({ storageState: emptyStorageStatePath() })`.
  const empty = { cookies: [], origins: [] };
  writeFileSync(emptyStorageStatePath(), JSON.stringify(empty), "utf8");
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  ensureStorageStateDir();
  writeEmptyStorageState();
  const workerCount = resolveWorkerCount(config);
  // biome-ignore lint/suspicious/noConsole: see comment in provisionWithSpacing.
  console.log(
    `[global-setup] provisioning ${workerCount} worker user(s) (configured workers=${String(config.workers)})`,
  );
  await provisionWithSpacing(workerCount);
}
