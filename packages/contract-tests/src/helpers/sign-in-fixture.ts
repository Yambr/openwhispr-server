// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 06 — sign-in fixture helper.
//
// Posts to `/api/auth/sign-in/email` (Better Auth's default) using a
// seeded fixture user's email + canonical fixture password. Returns a
// JarFetch whose CookieJar holds the resulting session cookie so the
// caller can immediately make authenticated requests.
//
// The seeded fixture password is `test-PW-12345!` — declared in
// `packages/data/src/seed/conformance.ts`. Tests that need an
// unverified user pass `{ verified: false }`; the helper then performs
// a temporary owner-pool flip-and-revert (Phase 02.20 / D-01 — Group I
// closure). See the verified:false branch comment below.
import { Pool } from "pg";
import { AUTH_URL } from "../env.js";
import { type JarFetch, makeJarFetch } from "./cookie-jar.js";

export const FIXTURE_PASSWORD = "test-PW-12345!";

// Phase 02.18 / D-02 — Module-scope counter to mint a unique
// X-Forwarded-For per signInFixture() call so each fixture lands in its
// own Better Auth rate-limit bucket (Better Auth resolves client IP from
// `x-forwarded-for` per the matching D-01 server config). Without this,
// parallel/sequential fixtures share the test-runner container's IP and
// trip the verification-status polling carve-out (~30 polls per
// (ip,email)) on adjacent tests.
//
// The deliberate D-28 rate-limit assertions are UNCHANGED:
//   - check-user.test.ts:42 hammers raw `fetch()` (no helper) with the
//     same opts — that flow exercises Traefik's per-real-IP bucket.
//   - verification-status.test.ts:48 reuses ONE JarFetch from a single
//     signInFixture() call inside its own loop — same IP, same email
//     bucket, intentional 31st-poll trigger.
//
// IPv4 second-octet rolls over harmlessly at 65536 calls (10.<a>.<b>.<c>).
//
// Vitest defaults to the `forks` pool — each test FILE runs in its own
// worker process. A naive per-module counter would re-use 10.0.0.1 across
// workers and re-collide buckets. Seed the counter with a 24-bit random
// offset at module load time so each worker starts from a different IP
// space (10.0.0.0/8 has 16M addresses; collision probability across <10
// workers × <100 calls each is negligible).
let xffCounter = Math.floor(Math.random() * 0xff_ff_ff);
function nextForwardedForIp(): string {
  xffCounter = (xffCounter + 1) & 0xff_ff_ff;
  // 10.0.0.0/8 is RFC 1918 private, never routable, never spoofable from
  // outside Traefik (which strips client X-Forwarded-For at the edge).
  const a = (xffCounter >>> 16) & 0xff;
  const b = (xffCounter >>> 8) & 0xff;
  const c = xffCounter & 0xff;
  return `10.${a}.${b}.${c}`;
}

export interface SignInOpts {
  /** When false the helper signs in a user whose email is NOT verified. */
  verified?: boolean;
}

/**
 * Perform the BA sign-in POST and return a JarFetch holding the session
 * cookie. Throws on non-2xx (callers surface as test failure).
 *
 * Extracted so the verified:false branch can wrap THIS function in the
 * owner-pool try/finally without duplicating the request shape.
 */
async function postSignIn(email: string): Promise<JarFetch> {
  const jf = makeJarFetch();
  const res = await jf.fetch(`${AUTH_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Phase 02.10 — Better Auth's CSRF gate rejects sign-in POSTs whose
      // Origin header is absent or not in `trustedOrigins` with HTTP 403
      // MISSING_OR_NULL_ORIGIN. Server-to-server fetch() doesn't auto-set
      // Origin; we forward AUTH_URL so the request matches the
      // `trustedOrigins: [AUTH_URL, OPENWHISPR_API_URL]` allowlist declared
      // in apps/api/src/auth.ts. Mirrors the proven seed-time pattern in
      // packages/data/src/seed/conformance.ts:46-58 (Phase 02.3).
      origin: AUTH_URL,
      // Phase 02.18 / D-02 — Per-call unique X-Forwarded-For so Better
      // Auth's rate-limiter (which reads `x-forwarded-for` per
      // apps/api/src/auth.ts advanced.ipAddress.ipAddressHeaders) buckets
      // each fixture independently. See comment at nextForwardedForIp().
      "x-forwarded-for": nextForwardedForIp(),
    },
    body: JSON.stringify({ email, password: FIXTURE_PASSWORD }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `signInFixture(${email}) failed: HTTP ${res.status} body=${text.slice(0, 200)}`,
    );
  }
  return jf;
}

/**
 * Sign in with email+password and return a JarFetch holding the session
 * cookie.
 *
 * Phase 02.20 / D-01 — Group I closure. When `opts.verified === false`,
 * Better Auth's `requireEmailVerification: true` would reject the
 * sign-in POST with HTTP 403 EMAIL_NOT_VERIFIED. To let the
 * verification-status contract test ("cookie + unverified → { verified:
 * false }") obtain a real BA-issued session cookie for an unverified
 * fixture user, the helper temporarily flips
 * users.email_verified=true via the owner DB pool (mirroring the
 * proven seed-time pattern in packages/data/src/seed/conformance.ts:95-105),
 * performs the sign-in, then reverts email_verified=false in a
 * try/finally so the revert fires even on sign-in throw / network
 * error. Empirically (advisor research), Better Auth's `getSession`
 * does NOT re-check `emailVerified`, so the resulting cookie remains
 * valid for read endpoints while the row reflects unverified state.
 *
 * Production-safety: this branch only executes when DATABASE_URL_OWNER
 * is set, which is contract-test-runner-internal only. ALL non-test
 * callers (production clients, third-party integrations) hitting
 * /api/auth/sign-in/email for an unverified user STILL receive 403
 * EMAIL_NOT_VERIFIED. requireEmailVerification:true is unchanged.
 *
 * Throws if Better Auth does not return a 2xx — tests catch and
 * surface as failures.
 */
export async function signInFixture(email: string, opts?: SignInOpts): Promise<JarFetch> {
  if (opts?.verified === false) {
    // Helper guard — load DATABASE_URL_OWNER lazily so default-path
    // callers (verified users) don't require it. Same shape as
    // packages/data/src/seed/conformance.ts:113.
    const ownerUrl = process.env.DATABASE_URL_OWNER;
    if (!ownerUrl) {
      throw new Error(
        "signInFixture({verified:false}): DATABASE_URL_OWNER not set — owner pool required to flip email_verified for unverified-user sign-in",
      );
    }

    const pool = new Pool({ connectionString: ownerUrl, max: 2 });
    try {
      // FLIP: temporarily mark the fixture row as verified so Better
      // Auth's requireEmailVerification:true gate does not block
      // /sign-in/email. lower(email) parameter binding mirrors
      // patchVerified() in seed/conformance.ts (case-insensitive lookup
      // for forward-compat with the Plan 02.7-05 functional unique
      // index `users_tenant_email_lower_unique`).
      await pool.query(
        `UPDATE users
            SET email_verified = true
          WHERE lower(email) = lower($1)`,
        [email],
      );

      try {
        // Sign in with the row temporarily verified. The BA cookie
        // returned is bound to the session row, NOT to the live
        // email_verified column (getSession does not re-check it).
        return await postSignIn(email);
      } finally {
        // REVERT: guaranteed on success, sign-in throw, AND network
        // error. The fixture row returns to email_verified=false so
        // the verification-status endpoint reports
        // { verified: false } as the contract requires.
        await pool.query(
          `UPDATE users
              SET email_verified = false
            WHERE lower(email) = lower($1)`,
          [email],
        );
      }
    } finally {
      // Close the owner pool exactly once regardless of outcome.
      await pool.end();
    }
  }

  // Default (verified user) path — unchanged from Phase 02.18.
  return postSignIn(email);
}
