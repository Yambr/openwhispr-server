// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 02.10 — TDD-01b RED test for Group A defect.
//
// Source-of-record commit: bde77b4 (Phase 02.10 CONTEXT — locks D-01: forward
// `Origin: AUTH_URL` from signInFixture so Better Auth's CSRF gate stops
// returning 403 MISSING_OR_NULL_ORIGIN). Mirrors the proven seed-time pattern
// from `packages/data/src/seed/conformance.ts:46-58` (Phase 02.3) which has
// been in production for the seed pipeline since the Plan 02 stack came up.
//
// Reverts:
//   Reverting the `origin: AUTH_URL` line in
//   `packages/contract-tests/src/helpers/sign-in-fixture.ts` reintroduces the
//   Group A regression (4 contract tests RED with HTTP 403 MISSING_OR_NULL_ORIGIN
//   on /api/auth/sign-in/email). Confirmed via reverse-patch in Phase 02.10.
//
// What this test asserts:
//   - signInFixture() POSTs to /api/auth/sign-in/email
//   - The init.headers passed to fetch contains an `origin` header
//   - The `origin` value equals the AUTH_URL constant resolved by env.ts
//
// We stub globalThis.fetch (which `cookie-jar.ts` calls directly on line 29)
// so we can capture the RequestInit without standing up Better Auth.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_URL } from "../../../../src/env.js";
import { signInFixture } from "../../../../src/helpers/sign-in-fixture.js";

describe("signInFixture — Origin header forwarding (Phase 02.10 Group A)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("forwards origin: AUTH_URL on the POST so Better Auth CSRF gate accepts the request", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await signInFixture("fixture@conformance.test");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];

    expect(calledUrl).toBe(`${AUTH_URL}/api/auth/sign-in/email`);

    // Headers may have been normalized into a Headers instance by cookie-jar.ts;
    // accept either a Headers object or a plain record.
    const headers = calledInit.headers;
    let originValue: string | null = null;
    if (headers instanceof Headers) {
      originValue = headers.get("origin");
    } else if (headers && typeof headers === "object") {
      const rec = headers as Record<string, string>;
      originValue = rec.origin ?? rec.Origin ?? null;
    }

    expect(originValue).toBe(AUTH_URL);
  });
});
