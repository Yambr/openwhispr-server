// Phase 07.1 / Plan 04 — Better Auth e2e fixture.
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
//
// D-TEST-3 compliance: no internal-logic mocks. The fixture talks to real
// apps/api endpoints over Traefik, real Postgres for the verification flip.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { APIRequestContext, Page } from "@playwright/test";

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
  const baseUrl = process.env.BASE_URL ?? "https://api.localhost";
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

async function patchEmailVerified(email: string): Promise<void> {
  // openwhispr_owner role bypasses RLS for the UPDATE.
  const sql = `UPDATE users SET email_verified=true, email_verified_at=now() WHERE email='${email.replace(/'/g, "''")}'`;
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
  const baseUrl = process.env.BASE_URL ?? "https://api.localhost";
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
