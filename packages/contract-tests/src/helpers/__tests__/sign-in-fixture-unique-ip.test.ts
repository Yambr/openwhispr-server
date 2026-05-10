// Phase 02.18 — TDD-RED test for D-02.
//
// Asserts that signInFixture() forwards a unique `x-forwarded-for` header
// per call, so each fixture lands in its own Better Auth rate-limit
// bucket. Without this, all parallel/sequential signInFixture() calls
// in the contract-test suite collapse onto a single shared rate-limit
// bucket (because the in-cluster source IP is the test runner container's
// IP), and the 30-poll-per-(ip,email) carve-out asserted by the
// verification-status polling test triggers prematurely on adjacent tests.
//
// Source-of-record: 02.18-CONTEXT.md § D-02 (locked decision: module-scope
// counter; each signInFixture() increments and forwards
// `x-forwarded-for: 10.0.0.<counter>`).
//
// Reverse-patch evidence: removing the per-call counter + header injection
// in `packages/contract-tests/src/helpers/sign-in-fixture.ts` returns this
// test to RED with two of three captured headers being equal.
//
// Deliberate D-28 assertions UNCHANGED: check-user 11th-call and
// verification-status 31st-poll hammer one IP intentionally (they don't
// go through this helper, OR they reuse the same JarFetch — see
// verification-status.test.ts:48 where the for-loop reuses `jf`).

import { afterEach, describe, expect, it, vi } from "vitest";
import { signInFixture } from "../sign-in-fixture.js";

describe("signInFixture — per-call unique X-Forwarded-For (Phase 02.18 / D-02)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("forwards a distinct x-forwarded-for header on each call so Better Auth's rate-limiter assigns each fixture its own bucket", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await signInFixture("a@conformance.test");
    await signInFixture("b@conformance.test");
    await signInFixture("c@conformance.test");

    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const xffValues: Array<string | null> = fetchSpy.mock.calls.map((call) => {
      const [, calledInit] = call as unknown as [string, RequestInit];
      const headers = calledInit.headers;
      if (headers instanceof Headers) {
        return headers.get("x-forwarded-for");
      }
      if (headers && typeof headers === "object") {
        const rec = headers as Record<string, string>;
        return rec["x-forwarded-for"] ?? rec["X-Forwarded-For"] ?? null;
      }
      return null;
    });

    // All three calls must include an x-forwarded-for header.
    for (const v of xffValues) {
      expect(v).not.toBeNull();
      expect(typeof v).toBe("string");
      expect((v ?? "").length).toBeGreaterThan(0);
    }

    // All three values must be distinct (per-call counter increment).
    const unique = new Set(xffValues);
    expect(unique.size).toBe(3);
  });
});
