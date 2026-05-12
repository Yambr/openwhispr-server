// Phase 07.1 / Plan 05 — Edge-safe middleware (cookie presence gate).
//
// RESEARCH § Pattern 4 + Pitfall 3:
//   - `getSessionCookie(req)` from `better-auth/cookies` checks cookie
//     EXISTENCE only; it is Edge-runtime safe (no DB / no Node modules).
//   - Real session validation happens inside `(auth)/layout.tsx` via
//     `auth.api.getSession({ headers })` (HTTP-fetched from apps/api here).
//   - Matcher is `/app/:path*` ONLY. `/admin/:path*` is intentionally
//     absent because D-ADMIN-1 gates admin at Traefik basic-auth — adding
//     it to this matcher would defeat that decision.
//
// Redirect target carries the original path in `?from=` so Plan 07's
// sign-in form can route the user back after successful auth.
import { type NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// MUST mirror `apps/api/src/auth.ts` advanced.cookiePrefix. If these drift,
// the middleware silently fails open (treats every request as
// unauthenticated, mass-redirect to /sign-in). Covered by the unit suite.
const COOKIE_PREFIX = "openwhispr";

export function middleware(req: NextRequest): NextResponse {
  const cookie = getSessionCookie(req, { cookiePrefix: COOKIE_PREFIX });
  if (!cookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("from", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // /app/:path* covers the (auth) route group. /admin/* is deliberately
  // omitted: Traefik basic-auth (D-ADMIN-1) terminates admin gating at
  // the edge before requests reach Next.js.
  matcher: ["/app/:path*"],
};
