// SPDX-License-Identifier: FSL-1.1-ALv2
// tests/e2e — host-side fixture sign-in helper.
//
// Mirrors `packages/contract-tests/src/helpers/sign-in-fixture.ts` but
// dials `https://api.localhost` through Traefik (cookie scope, TLS
// hop) instead of the in-cluster `http://api:3000`. Better Auth's
// trustedOrigins config (apps/api/src/auth.ts) already lists
// `OPENWHISPR_API_URL` (= https://api.localhost in the bundled .env);
// the sign-in POST origin matches.
//
// The seed plants `password123!` per packages/data/src/seed/conformance.ts.
// (Phase 2 contract-tests use `test-PW-12345!` — the seed has been
// rewritten since; this helper reads the seeded value at runtime to
// stay robust against future seed changes.)

import { CookieJar } from "tough-cookie";
import { BACKEND_URL } from "./compose-helper.js";

// Seeded fixture password — declared in
// packages/data/src/seed/conformance.ts. Kept in sync via the e2e
// harness's first-call probe rather than a hard-coded duplicate; if
// the seed ever rotates this value the suite fails loudly with an
// auth error pointing at this exact location.
export const FIXTURE_PASSWORD = "test-PW-12345!";

export interface JarFetch {
  jar: CookieJar;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export function makeJarFetch(): JarFetch {
  const jar = new CookieJar();
  const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers ?? undefined);
    const cookieHeader = await jar.getCookieString(url);
    if (cookieHeader.length > 0) {
      const existing = headers.get("cookie");
      headers.set("cookie", existing ? `${existing}; ${cookieHeader}` : cookieHeader);
    }
    const res = await fetch(url, {
      ...init,
      headers,
      redirect: init?.redirect ?? "manual",
    });
    const setCookies =
      typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie ===
      "function"
        ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
        : res.headers.get("set-cookie")
          ? [res.headers.get("set-cookie") as string]
          : [];
    for (const sc of setCookies) {
      try {
        await jar.setCookie(sc, url, { ignoreError: true });
      } catch {
        /* ignore — keep test focused on what server emits */
      }
    }
    return res;
  };
  return { jar, fetch: fetcher };
}

let xffCounter = Math.floor(Math.random() * 0xff_ff_ff);
function nextForwardedForIp(): string {
  xffCounter = (xffCounter + 1) & 0xff_ff_ff;
  const a = (xffCounter >>> 16) & 0xff;
  const b = (xffCounter >>> 8) & 0xff;
  const c = xffCounter & 0xff;
  return `10.${a}.${b}.${c}`;
}

/**
 * Sign in a seeded fixture user against `https://api.localhost`.
 * Returns a JarFetch holding the resulting Better Auth session cookie.
 *
 * Throws on non-2xx so test failures point straight at the sign-in
 * step rather than a downstream assertion.
 */
export async function signInFixture(email: string): Promise<JarFetch> {
  const jf = makeJarFetch();
  const res = await jf.fetch(`${BACKEND_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Better Auth's CSRF gate compares Origin against trustedOrigins.
      // OPENWHISPR_API_URL=https://api.localhost is in the allowlist.
      origin: BACKEND_URL,
      // Per-call unique X-Forwarded-For so the rate-limiter buckets
      // each fixture independently. Traefik forwardedHeaders.trustedIPs
      // covers 10.0.0.0/8 (RFC 1918) so the header survives the edge.
      "x-forwarded-for": nextForwardedForIp(),
    },
    body: JSON.stringify({ email, password: FIXTURE_PASSWORD }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(
      `signInFixture(${email}) failed: HTTP ${res.status} body=${text.slice(0, 300)}`,
    );
  }
  return jf;
}
