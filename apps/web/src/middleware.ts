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
//   - Auth matcher is NOT widened to /admin/* — D-ADMIN-1 keeps the
//     Traefik basic-auth gate authoritative for admin.

import acceptLanguageParser from "accept-language-parser";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

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

  // Auth gate for /app/* — runs BEFORE the NextResponse.next() so the
  // redirect short-circuits the rest. Locale resolution still happened, so
  // callers that inspect the redirect URL can read the locale from the
  // cookie passthrough.
  if (req.nextUrl.pathname.startsWith("/app/")) {
    const cookie = getSessionCookie(req, { cookiePrefix: COOKIE_PREFIX });
    if (!cookie) {
      const url = req.nextUrl.clone();
      url.pathname = "/sign-in";
      url.searchParams.set("from", req.nextUrl.pathname);
      return NextResponse.redirect(url);
    }
  }

  // Forward `x-locale` to downstream RSC handlers. Setting it through the
  // `request.headers` init on NextResponse.next() is the documented Next.js
  // pattern — Next surfaces the overrides as the `x-middleware-override-
  // headers` + per-header `x-middleware-request-x-locale` response headers,
  // and rewrites the actual request headers before the route handler runs.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-locale", locale);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Phase 10 / Plan 02 — widened from `/app/:path*` to also catch the public
  // and auth routes so they receive `x-locale`. Static assets, the Next
  // build manifest, and image optimization are excluded.
  matcher: ["/((?!_next/|favicon|.*\\..*).*)"],
};
