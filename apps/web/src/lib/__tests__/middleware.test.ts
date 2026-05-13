// Phase 07.1 / Plan 05 — middleware unit tests (RED before GREEN).
//
// We exercise the Edge middleware function directly against a synthetic
// NextRequest. `better-auth/cookies` is real — no internal-logic mocks
// (CLAUDE.md). The function is a pure cookie-existence check.
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

// Edge middleware lives outside src/lib/, so coverage on it is exercised
// via Playwright in tests/e2e/05-auth-middleware.spec.ts; this unit suite
// covers the redirect-shape contract that the Plan 07 sign-in form
// depends on.
import { config, middleware } from "../../middleware";

// NextRequest under happy-dom enforces fetch's forbidden-header rules
// (the `cookie` header cannot be set directly via the Headers init in a
// browser-like environment). We therefore set the cookie via the
// `req.cookies` API, which is what middleware code reads through
// `getSessionCookie(req)` anyway (Better Auth's helper inspects
// `request.headers.get('cookie')`, and NextRequest synthesizes that
// header from the cookies jar).
function makeReq(pathname: string, cookie?: { name: string; value: string }): NextRequest {
  const req = new NextRequest(new URL(`https://api.localhost${pathname}`));
  if (cookie) req.cookies.set(cookie.name, cookie.value);
  return req;
}

describe("middleware.ts (Phase 07.1 / Plan 05)", () => {
  it("redirects to /sign-in when no session cookie is present", () => {
    const res = middleware(makeReq("/app/usage"));
    expect(res.status).toBe(307);
    const loc = res.headers.get("location")!;
    const url = new URL(loc);
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("from")).toBe("/app/usage");
  });

  it("forwards the original path in ?from= for sign-in routing", () => {
    const res = middleware(makeReq("/app/account"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("from")).toBe("/app/account");
  });

  it("passes through (NextResponse.next) when a Better Auth session cookie is present", () => {
    const res = middleware(
      makeReq("/app/usage", { name: "openwhispr.session_token", value: "abc.signature" }),
    );
    // NextResponse.next() returns a 200 sentinel response with the
    // `x-middleware-next` header set; status is 200.
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("matcher excludes /admin/* (D-ADMIN-1: Traefik basic-auth gate authoritative)", () => {
    // Phase 10 / Plan 02 widened the matcher to also catch public and auth
    // routes so the locale-negotiation `x-locale` header is set on every
    // page render. The widened pattern still excludes static assets
    // (`/_next/*`, files with extensions) AND must continue to exclude
    // `/admin/*` per D-ADMIN-1 — admin is gated at Traefik basic-auth
    // before reaching Next.js.
    expect(config.matcher).toEqual(["/((?!_next/|favicon|.*\\..*).*)"]);
    // Sanity: the regex must not literally name /admin/:path* — that would
    // have been the old, narrower form.
    expect(config.matcher).not.toContain("/admin/:path*");
  });
});
