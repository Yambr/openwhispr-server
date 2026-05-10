// Phase 2 / Plan 06 — sign-in fixture helper.
//
// Posts to `/api/auth/sign-in/email` (Better Auth's default) using a
// seeded fixture user's email + canonical fixture password. Returns a
// JarFetch whose CookieJar holds the resulting session cookie so the
// caller can immediately make authenticated requests.
//
// The seeded fixture password is `test-PW-12345!` — declared in
// `packages/data/src/seed/conformance.ts`. Tests that need an
// unverified user pass `{ verified: false }` and signInFixture targets
// `pending@conformance.test` rather than verifying the email afterward
// (v1 has no in-test email-link click harness).
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
 * Sign in with email+password and return a JarFetch holding the session
 * cookie. Throws if Better Auth does not return a 2xx — tests catch and
 * surface as failures.
 */
export async function signInFixture(email: string, _opts?: SignInOpts): Promise<JarFetch> {
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
