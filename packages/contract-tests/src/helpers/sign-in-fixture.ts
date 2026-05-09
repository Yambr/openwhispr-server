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
import { makeJarFetch, type JarFetch } from "./cookie-jar.js";

export const FIXTURE_PASSWORD = "test-PW-12345!";

export interface SignInOpts {
  /** When false the helper signs in a user whose email is NOT verified. */
  verified?: boolean;
}

/**
 * Sign in with email+password and return a JarFetch holding the session
 * cookie. Throws if Better Auth does not return a 2xx — tests catch and
 * surface as failures.
 */
export async function signInFixture(
  email: string,
  _opts?: SignInOpts,
): Promise<JarFetch> {
  const jf = makeJarFetch();
  const res = await jf.fetch(`${AUTH_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
