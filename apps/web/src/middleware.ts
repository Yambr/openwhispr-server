// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 05 + Phase 10 / Plan 02 — Edge middleware.
//
// Two concerns share this entry point:
//   1. Locale negotiation (Phase 10 / Plan 02). The Edge runtime resolves
//      the active locale from (cookie NEXT_LOCALE → Accept-Language → "en")
//      and forwards the result as the `x-locale` request header so the
//      RSC root layout can render with the matching i18n resources. The
//      negotiation runs on every request that the matcher catches.
//   2. Authentication cookie gate (Phase 07.1 / Plan 05). For `/app/:path*`
//      we additionally check Better Auth's session-cookie EXISTENCE via
//      `getSessionCookie(req)` — an Edge-safe helper that performs no DB
//      / network I/O. Real session validation happens inside the RSC
//      (auth) layout (Pitfall 3).
//
// Matcher widened in Phase 10 / Plan 02 from `/app/:path*` to `/((?!_next/
// |favicon|.*\\..*).*)` so the locale header is also set on `/sign-in`,
// `/sign-up`, `/verify-email`, and the public `/` route. Static assets are
// excluded by the path filter to avoid wasted compute.
//
// Anti-patterns intentionally avoided:
//   - No `next-intl` middleware. The negotiation surface is two locales
//     + cookie + Accept-Language; a 5kB dep would add no value.
//   - Auth matcher is NOT widened to /admin/* — the (admin) layout
//     applies the role gate itself (checkAdminAccess(), see
//     lib/admin-guard.ts), so a middleware match would be redundant.

import acceptLanguageParser from "accept-language-parser";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Phase 51 / Plan 51-04 (REVIEW CR-5) — per-request CSP nonce.
 *
 * Pre-fix, `apps/web/next.config.ts` shipped `script-src 'self'
 * 'unsafe-inline'` globally because Next.js 15 emits an inline
 * `self.__next_f.push(...)` hydration bootstrap. The fix:
 *
 *   1. Middleware generates 16 fresh bytes per request, base64url-encodes
 *      them, and forwards as `x-nonce` on the downstream RSC request.
 *   2. Middleware sets `Content-Security-Policy` on the response with
 *      `script-src 'self' 'nonce-<value>' 'strict-dynamic'`. The
 *      `'strict-dynamic'` keyword lets a script with the nonce load
 *      further scripts without each one needing its own nonce — this
 *      matches Next.js's own canonical CSP recipe.
 *   3. `next.config.ts` headers() emits everything EXCEPT
 *      Content-Security-Policy; middleware CSP wins because the
 *      headers run later in the response chain.
 *   4. Next.js 15 detects the per-request nonce via the `headers()`
 *      RSC accessor reading `x-nonce` and emits `<script nonce=...>`
 *      tags automatically (documented in next.js.org/docs/app/building-
 *      your-application/configuring/content-security-policy).
 */
function buildCsp(nonce: string): string {
  // Phase 53 / Plan 53-08 — `'wasm-unsafe-eval'` admits the
  // `Function(...)` constructor calls Next.js 15's compiled chunks
  // emit (amphtml-validator, lodash internals, pretty-format, etc.
  // — bundled deps that pre-date the Function()-free era). Without
  // it the browser blocks the chunk and the page renders blank.
  // `'wasm-unsafe-eval'` is the narrowest CSP keyword that admits
  // WASM-compatible Function construction without opening up
  // `eval()` (the broader `'unsafe-eval'`). Verified via
  // `grep "return Function(" node_modules/.pnpm/next@*` —
  // every occurrence is in compiled-dep code, not user code.
  return (
    `default-src 'self'; ` +
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'; ` +
    `style-src 'self' 'unsafe-inline'; ` +
    `img-src 'self' data: blob:; ` +
    `font-src 'self'; ` +
    `connect-src 'self'; ` +
    `frame-ancestors 'none'; ` +
    `base-uri 'self'; ` +
    `form-action 'self'`
  );
}

function generateNonce(): string {
  // crypto.getRandomValues is available in the Edge runtime
  // unconditionally; 16 bytes is the CSP-recipe canonical width.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // base64url-encode without Node `Buffer` (Edge runtime lacks it).
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// MUST mirror `apps/api/src/auth.ts` advanced.cookiePrefix. If these drift,
// the middleware silently fails open (treats every request as
// unauthenticated, mass-redirect to /sign-in). Covered by the unit suite.
const COOKIE_PREFIX = "openwhispr";

// Supported locales (D-STACK-7, expanded for Phase 10). Order matters for
// `pick`: the first preferred-by-client match wins.
const SUPPORTED_LOCALES = ["en", "ru"] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
const DEFAULT_LOCALE: SupportedLocale = "en";

function isSupportedLocale(value: string | undefined): value is SupportedLocale {
  return value !== undefined && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Resolve the active locale for a request following the precedence chain:
 *   1. NEXT_LOCALE cookie (if it names a supported locale)
 *   2. Accept-Language header (best q-weighted supported match)
 *   3. DEFAULT_LOCALE ("en")
 *
 * Exported for unit-test introspection.
 */
export function resolveLocale(req: NextRequest): SupportedLocale {
  const cookieLocale = req.cookies.get("NEXT_LOCALE")?.value;
  if (isSupportedLocale(cookieLocale)) return cookieLocale;

  const accept = req.headers.get("accept-language");
  if (accept) {
    const picked = acceptLanguageParser.pick(SUPPORTED_LOCALES as unknown as string[], accept, {
      loose: true,
    });
    if (isSupportedLocale(picked ?? undefined)) return picked as SupportedLocale;
  }

  return DEFAULT_LOCALE;
}

export function middleware(req: NextRequest): NextResponse {
  const locale = resolveLocale(req);

  // Auth gate for /app and /app/* — runs BEFORE the NextResponse.next()
  // so the redirect short-circuits the rest. Locale resolution still
  // happened, so callers that inspect the redirect URL can read the
  // locale from the cookie passthrough.
  //
  // Phase 55-03-c fix (BUG-55-03-c-FROM-PARAM-LOST): the matcher
  // previously checked `startsWith("/app/")` (with trailing slash),
  // which missed the bare `/app` path. That fell through to the
  // `(auth)/layout.tsx` server-side guard which `redirect("/sign-in")`
  // s without preserving the original path → users lost the deep-link
  // post-sign-in. Match bare `/app` AND `/app/*`.
  const path = req.nextUrl.pathname;
  if (path === "/app" || path.startsWith("/app/")) {
    const cookie = getSessionCookie(req, { cookiePrefix: COOKIE_PREFIX });
    if (!cookie) {
      const url = req.nextUrl.clone();
      url.pathname = "/sign-in";
      url.searchParams.set("from", path);
      return NextResponse.redirect(url);
    }
  }

  // Phase 51 / Plan 51-04 (REVIEW CR-5) — per-request CSP nonce.
  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  // Forward `x-locale` AND `x-nonce` to downstream RSC handlers. Setting
  // headers through the `request.headers` init on NextResponse.next() is
  // the documented Next.js pattern — Next 15 also reads x-nonce here
  // and stamps it onto every `<script>` tag it emits, retiring the need
  // for `'unsafe-inline'` in script-src.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-locale", locale);
  requestHeaders.set("x-nonce", nonce);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // Phase 10 / Plan 02 — widened from `/app/:path*` to also catch the public
  // and auth routes so they receive `x-locale`. Static assets, the Next
  // build manifest, and image optimization are excluded.
  matcher: ["/((?!_next/|favicon|.*\\..*).*)"],
};
