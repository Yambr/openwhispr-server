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

function makeReq(pathname: string, cookieHeader?: string): NextRequest {
  const headers = new Headers();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  return new NextRequest(new URL(`https://api.localhost${pathname}`), { headers });
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
      makeReq("/app/usage", "openwhispr.session_token=abc.signature"),
    );
    // NextResponse.next() returns a 200 sentinel response with the
    // `x-middleware-next` header set; status is 200.
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("matcher targets /app/:path* only (D-ADMIN-1: no /admin in matcher)", () => {
    expect(config.matcher).toEqual(["/app/:path*"]);
    expect(config.matcher).not.toContain("/admin/:path*");
  });
});
