// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 13.1 — Better Auth e2e fixture (worker-scoped storageState).
//
// Provides:
//   - provisionTestUser(workerIndex) — idempotently signs up alice+<i>@test.local
//     against the real Better Auth /api/auth/sign-up/email, then patches
//     email_verified=true via `docker compose exec postgres psql` (Better Auth
//     has `requireEmailVerification: true` and there is no env toggle —
//     we mirror packages/data/src/seed/conformance.ts.patchVerified).
//   - signIn(page, email, password) — fetches /api/auth/sign-in/email through
//     the page's request context so cookies are set on the page.
//   - signInAs(page, email) — convenience wrapper using the canonical password.
//   - storageStatePath(workerIndex) — worker-scoped storageState location.
//   - provisionUserOnce(workerIndex) — invoked by global-setup.ts: provisions
//     the fixture user AND saves a signed-in storageState JSON to disk so
//     every spec in that worker can reuse it via `test.use({ storageState })`.
//     This is the core mitigation for Better Auth's sign-up/sign-in rate
//     limiter — each worker hits the auth endpoints exactly once per run.
//   - test (extended) — exports a Playwright `test` whose `storageState`
//     fixture resolves to the per-worker auth state file. Specs that need
//     a signed-in user import `test` / `expect` from this module.
//
// D-TEST-3 compliance: no internal-logic mocks. The fixture talks to real
// apps/api endpoints over Traefik, real Postgres for the verification flip.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  type APIRequestContext,
  test as baseTest,
  type Page,
  request as playwrightRequest,
} from "@playwright/test";
// Phase 53 / Plan 53-12 — static import (instead of dynamic await import())
// so Playwright's loader resolves the `.js → .ts` remap statically. The
// prior dynamic-import form tripped a `SyntaxError: Unexpected token
// 'export'` on every spec that goes through the auth fixture because
// Playwright's runtime dynamic-import path does not apply the same
// transformation pipeline the static-import path does.
import {
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
  getCapturedDiagnostics,
} from "../support/browser-diagnostics.js";
import { getProcessOrigins } from "../support/topology.js";

const execFileAsync = promisify(execFile);

export const FIXTURE_PASSWORD = "Pwa9!#testStrong";
export const FIXTURE_EMAIL_DOMAIN = "test.local";
export const STORAGE_STATE_DIR = path.resolve(__dirname, "../.auth");

export function fixtureEmail(workerIndex: number): string {
  return `alice+${workerIndex}@${FIXTURE_EMAIL_DOMAIN}`;
}

export function storageStatePath(workerIndex: number): string {
  return path.join(STORAGE_STATE_DIR, `alice-${workerIndex}.json`);
}

/**
 * Idempotently sign up + email-verify the fixture user. Returns the email
 * created. Safe to call repeatedly — Better Auth returns
 * USER_ALREADY_EXISTS (HTTP 422) on duplicates which we accept.
 */
export async function provisionTestUser(
  request: APIRequestContext,
  workerIndex: number,
): Promise<string> {
  const email = fixtureEmail(workerIndex);
  const baseUrl = process.env.BASE_URL ?? getProcessOrigins().apiOrigin;
  const res = await request.post(`${baseUrl}/api/auth/sign-up/email`, {
    headers: {
      "content-type": "application/json",
      // Better Auth's CSRF gate compares Origin to trustedOrigins
      // (apps/api/src/auth.ts) — AUTH_URL/OPENWHISPR_API_URL are both
      // https://api.localhost in dev, so use baseURL.
      origin: baseUrl,
    },
    data: {
      email,
      password: FIXTURE_PASSWORD,
      name: `Alice ${workerIndex}`,
    },
    ignoreHTTPSErrors: true,
  });
  if (!res.ok()) {
    const status = res.status();
    const body = await res.text();
    let parsed: { code?: string; message?: string } = {};
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      /* non-JSON */
    }
    const isDuplicate =
      parsed.code === "USER_ALREADY_EXISTS" || /already exists/i.test(parsed.message ?? "");
    if (!isDuplicate) {
      throw new Error(
        `provisionTestUser(${email}) failed: HTTP ${status} body=${body.slice(0, 300)}`,
      );
    }
  }
  // Flip email_verified=true via docker compose exec — the apps/api Better
  // Auth config has requireEmailVerification:true and no test bypass.
  // Same pattern as packages/data/src/seed/conformance.ts.patchVerified.
  await patchEmailVerified(email);
  return email;
}

/**
 * Probe whether a fixture user already exists in Postgres. Lets
 * `provisionUserOnce` short-circuit /api/auth/sign-up/email calls on
 * subsequent test runs (the user row survives across runs — only
 * resource rows are cleaned by `clearAllData`).
 */
async function userExistsInDb(email: string): Promise<boolean> {
  const sql = `SELECT 1 FROM users WHERE email='${email.replace(/'/g, "''")}' LIMIT 1`;
  try {
    const { stdout } = await execFileAsync("docker", [
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
      "-tA",
      "-c",
      sql,
    ]);
    return stdout.trim() === "1";
  } catch {
    return false;
  }
}

/** Exported alias of the internal patchEmailVerified used by provisionUserOnce. */
async function patchEmailVerifiedExternal(email: string): Promise<void> {
  return patchEmailVerified(email);
}

async function patchEmailVerified(email: string): Promise<void> {
  // openwhispr_owner role bypasses RLS for the UPDATE.
  // Phase 53 / Plan 53-25 — also flip role='admin' so /admin/* specs
  // (a2-observability, a3-config) clear the 403 gate. Under Traefik,
  // admin surfaces are double-gated by basic-auth + the role check;
  // slim relies on the role check alone, so the fixture user must
  // be promoted. Both updates land in a single SQL statement to
  // keep the docker exec round-trip count constant.
  const sql =
    `UPDATE users SET email_verified=true, email_verified_at=now(), role='admin' ` +
    `WHERE email='${email.replace(/'/g, "''")}'`;
  await execFileAsync("docker", [
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
  ]);
}

export interface SignInResult {
  email: string;
}

/**
 * Sign the page in by posting credentials to Better Auth and letting the
 * Set-Cookie headers propagate into the page's request context. Returns the
 * email used. Caller MUST have already called provisionTestUser for this email.
 */
export async function signIn(
  page: Page,
  email: string,
  password: string = FIXTURE_PASSWORD,
): Promise<SignInResult> {
  const baseUrl = process.env.BASE_URL ?? getProcessOrigins().apiOrigin;
  const res = await page.request.post(`${baseUrl}/api/auth/sign-in/email`, {
    headers: { "content-type": "application/json", origin: baseUrl },
    data: { email, password },
    ignoreHTTPSErrors: true,
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`signIn(${email}) failed: HTTP ${res.status()} body=${body.slice(0, 300)}`);
  }
  return { email };
}

/**
 * Convenience: sign in using the canonical fixture password and the email
 * shape `alice+<workerIndex>@test.local`. Provisions first if needed.
 */
export async function signInAs(page: Page, email: string): Promise<SignInResult> {
  return signIn(page, email, FIXTURE_PASSWORD);
}

/** Ensure the per-worker storage state directory exists. */
export function ensureStorageStateDir(): void {
  if (!existsSync(STORAGE_STATE_DIR)) {
    mkdirSync(STORAGE_STATE_DIR, { recursive: true });
  }
}

/**
 * Global-setup entry point. Provision the worker-scoped fixture user
 * (idempotently — DB UPSERT semantics; Better Auth USER_ALREADY_EXISTS
 * is swallowed), sign in once over a fresh APIRequestContext, then write
 * the resulting cookie jar to `storageStatePath(workerIndex)` so every
 * test in the worker can reuse it via `test.use({ storageState })`.
 *
 * This is the SOLE place that should call /api/auth/sign-up/email and
 * /api/auth/sign-in/email per test run per worker. Spec-level calls were
 * tripping Better Auth's anti-abuse rate limiter (Plan 13 deviation:
 * 57/85 HTTP 429 failures in the full suite). Each spec now inherits a
 * cookie jar rather than re-authenticating in beforeEach.
 */
export async function provisionUserOnce(workerIndex: number): Promise<string> {
  ensureStorageStateDir();
  // Phase 53 / Plan 53-21 — provisioning must happen through the WEB
  // origin so the resulting Set-Cookie lands on the hostname the spec
  // pages will use. Under Traefik both origins share api.localhost so
  // the distinction is moot; under slim, web=localhost:3000 and
  // api=localhost:4000 are cross-origin — cookies set on :4000 do not
  // travel to :3000. The web Next.js rewrites() proxy forwards
  // /api/auth/* through to the api container, so we can hit the
  // sign-in endpoint via the web origin and inherit cookies on the
  // correct hostname.
  const origins = getProcessOrigins();
  const baseUrl = process.env.BASE_URL ?? origins.webOrigin;
  const apiUrl = process.env.BASE_URL ?? origins.apiOrigin;
  const email = fixtureEmail(workerIndex);
  // Fresh APIRequestContext — no inherited cookies. baseURL is the
  // origin where the storageState cookies should land (web origin
  // under slim, api.localhost under traefik). The sign-up call below
  // goes directly to apiUrl because the web rewrites only cover
  // /api/auth/* — direct sign-up/sign-in via apiUrl is fine because
  // the global-setup runs Server-Side and is not subject to browser
  // cookie scoping; storageState saved against baseURL gets re-loaded
  // into a browser context that targets the same baseURL.
  const ctx = await playwrightRequest.newContext({
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
  });
  try {
    // Probe DB first to avoid burning a /api/auth/sign-up/email call on
    // an already-provisioned user. Better Auth's anti-abuse limiter has
    // tight per-IP windows on sign-up (60s cooldown empirically); reusing
    // the existing row across runs keeps total auth-endpoint hits at
    // exactly `workers` per provisioned worker per test run.
    if (await userExistsInDb(email)) {
      // Ensure email_verified=true regardless (cheap, idempotent).
      await patchEmailVerifiedExternal(email);
    } else {
      await provisionTestUser(ctx, workerIndex);
    }
    // Sign-in with bounded retry/backoff. Better Auth's anti-abuse limiter
    // buckets POST /api/auth/sign-in/email per-IP (~3 requests / 10s
    // window in default config). Global-setup hits it once per worker
    // serially; with workers ≥ 4 we can clip the window edge. Backoff
    // converges within ~30s for any realistic worker count.
    let signInOk = false;
    let lastStatus = 0;
    let lastBody = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const signInRes = await ctx.post(`${baseUrl}/api/auth/sign-in/email`, {
        headers: { "content-type": "application/json", origin: baseUrl },
        data: { email, password: FIXTURE_PASSWORD },
        ignoreHTTPSErrors: true,
      });
      if (signInRes.ok()) {
        signInOk = true;
        break;
      }
      lastStatus = signInRes.status();
      lastBody = await signInRes.text();
      if (lastStatus !== 429) break;
      // 5s, 10s, 15s, 20s — total worst case 50s ceiling.
      await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)));
    }
    if (!signInOk) {
      throw new Error(
        `provisionUserOnce(${email}) sign-in failed: HTTP ${lastStatus} body=${lastBody.slice(0, 300)}`,
      );
    }
    await ctx.storageState({ path: storageStatePath(workerIndex) });
  } finally {
    await ctx.dispose();
  }
  return email;
}

/**
 * Empty / unauthenticated storage state path. Specs that exercise the
 * sign-in / sign-up / verify-email surfaces must start with no session
 * cookie. We write a single shared "empty" storage state file at
 * global-setup time so those specs can opt in via
 * `test.use({ storageState: emptyStorageStatePath() })` without each one
 * crafting its own.
 */
export function emptyStorageStatePath(): string {
  return path.join(STORAGE_STATE_DIR, "empty.json");
}

/**
 * Playwright `test` extended with a `storageState` fixture that resolves
 * to the per-worker signed-in cookie jar produced by `provisionUserOnce`.
 *
 * Usage:
 *   import { test, expect } from "./fixtures/auth.js";
 *   test("requires a signed-in user", async ({ page }) => { ... });
 *
 * Specs that need to start signed-out (U1/U2/U3) must NOT import from
 * here; they keep using `@playwright/test`'s base `test` (default empty
 * storage state).
 */
export const test = baseTest.extend<{ _attachDiagnostics: void }>({
  // Phase 53 / Plan 53-03 — auto-attach browser-diagnostics helper to
  // every spec that imports `test` from this fixture. The auto:true
  // flag triggers eager evaluation per-test without the spec needing
  // to destructure the fixture name. After the test body, the captured
  // diagnostics are attached to testInfo for postmortem. When the env
  // gate PHASE53_STRICT_DIAGNOSTICS=1 is set, any error-severity
  // captured entry FAILS the test (per Phase 53 contract).
  _attachDiagnostics: [
    async ({ page }, use, testInfo) => {
      await attachBrowserDiagnostics(page);
      await use();
      const diag = getCapturedDiagnostics(page);
      if (diag.length > 0) {
        await testInfo.attach("browser-diagnostics.json", {
          body: JSON.stringify(diag, null, 2),
          contentType: "application/json",
        });
      }
      if (process.env.PHASE53_STRICT_DIAGNOSTICS === "1") {
        expectNoBrowserErrors(page);
      }
    },
    { auto: true },
  ],
  // Override the built-in `storageState` fixture so every test inherits
  // the per-slot signed-in cookie jar written by global-setup.ts.
  //
  // IMPORTANT: we key on `parallelIndex`, NOT `workerIndex`. Playwright
  // monotonically increments `workerIndex` every time a worker process
  // is respawned (after a test failure, after a worker timeout, etc.),
  // so it can blow past the number of slots we provisioned. By contrast
  // `parallelIndex` is the stable 0..workers-1 slot id Playwright
  // recycles across worker restarts — exactly the mapping global-setup
  // pre-populates.
  // Playwright reads the fixture's first parameter via
  // Function.prototype.toString to discover dependencies. The destructure
  // (`{}` even if empty) is part of that protocol; replacing it with `_`
  // makes Playwright think the fixture depends on the entire bag.
  // biome-ignore lint/correctness/noEmptyPattern: see comment above
  storageState: async ({}, use, testInfo) => {
    await use(storageStatePath(testInfo.parallelIndex));
  },
});

export { expect } from "@playwright/test";
