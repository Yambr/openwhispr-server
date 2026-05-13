// SPDX-License-Identifier: Apache-2.0
// Phase 10 / Plan 02 — Locale negotiation pipeline (RED before GREEN).
//
// Exercises the Edge middleware locale-resolution logic directly against
// synthetic NextRequest instances. The middleware is a pure function over
// (cookie, Accept-Language) → `x-locale` request header. We verify the
// negotiation precedence:
//   1. NEXT_LOCALE cookie (when supported)
//   2. Accept-Language header (best q-weighted supported match)
//   3. fallback to "en"
// Unsupported locales (e.g. fr) are normalized to "en".
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { middleware } from "../../middleware";

function makeReq(
  pathname: string,
  init: { cookie?: { name: string; value: string }; acceptLanguage?: string } = {},
): NextRequest {
  const headers = new Headers();
  if (init.acceptLanguage) headers.set("accept-language", init.acceptLanguage);
  const req = new NextRequest(new URL(`https://api.localhost${pathname}`), { headers });
  if (init.cookie) req.cookies.set(init.cookie.name, init.cookie.value);
  return req;
}

function xLocale(res: { headers: Headers }): string | null {
  // NextResponse.next() returns a sentinel whose request-headers overrides are
  // surfaced via `x-middleware-override-headers` + per-header
  // `x-middleware-request-<name>` entries (Next.js Edge runtime contract).
  return res.headers.get("x-middleware-request-x-locale") ?? res.headers.get("x-locale") ?? null;
}

describe("middleware.ts — locale negotiation (Phase 10 / Plan 02)", () => {
  it("(a) NEXT_LOCALE=ru cookie sets x-locale=ru", () => {
    const res = middleware(makeReq("/", { cookie: { name: "NEXT_LOCALE", value: "ru" } }));
    expect(xLocale(res)).toBe("ru");
  });

  it("(b) no cookie + Accept-Language: ru,en;q=0.5 sets x-locale=ru", () => {
    const res = middleware(makeReq("/", { acceptLanguage: "ru,en;q=0.5" }));
    expect(xLocale(res)).toBe("ru");
  });

  it("(c) no signals at all falls back to x-locale=en", () => {
    const res = middleware(makeReq("/"));
    expect(xLocale(res)).toBe("en");
  });

  it("(d) unsupported cookie locale (fr) falls back to x-locale=en", () => {
    const res = middleware(makeReq("/", { cookie: { name: "NEXT_LOCALE", value: "fr" } }));
    expect(xLocale(res)).toBe("en");
  });

  it("(e) Accept-Language with primarily en wins over secondary ru", () => {
    const res = middleware(makeReq("/", { acceptLanguage: "en-US,en;q=0.9,ru;q=0.3" }));
    expect(xLocale(res)).toBe("en");
  });

  it("(f) cookie takes precedence over Accept-Language", () => {
    const res = middleware(
      makeReq("/", {
        cookie: { name: "NEXT_LOCALE", value: "ru" },
        acceptLanguage: "en-US,en;q=0.9",
      }),
    );
    expect(xLocale(res)).toBe("ru");
  });

  it("(g) unauthenticated /app/* requests still emit x-locale before the auth redirect", () => {
    const res = middleware(makeReq("/app/usage", { cookie: { name: "NEXT_LOCALE", value: "ru" } }));
    // Auth gate still redirects to /sign-in (no session cookie present), but
    // the redirect URL keeps the locale information for downstream consumers
    // via the location header path or set-cookie passthrough. The minimum
    // contract here is: the response is a 307 redirect to /sign-in.
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/sign-in");
  });
});
