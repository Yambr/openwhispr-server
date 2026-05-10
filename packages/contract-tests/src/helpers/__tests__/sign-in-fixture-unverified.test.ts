// Phase 02.20 — TDD-RED test for D-01 (Group I closure).
//
// Asserts that signInFixture(email, { verified: false }) wraps the
// sign-in HTTP POST in a guaranteed flip-and-revert against the owner
// pool: BEFORE the POST, UPDATE users SET email_verified=true WHERE
// lower(email)=lower($1); AFTER the POST (in a try/finally so the
// revert fires on success, throw, OR network error), UPDATE users SET
// email_verified=false on the same row. The pool is opened against
// process.env.DATABASE_URL_OWNER and closed exactly once.
//
// Why this exists:
//   The contract test `verification-status > cookie + unverified`
//   needs a real Better Auth session cookie for `pending@conformance.test`
//   so it can hit GET /api/auth/verification-status with cookie auth and
//   assert `{ verified: false }`. But Better Auth's
//   /api/auth/sign-in/email rejects unverified users with 403
//   EMAIL_NOT_VERIFIED by design (`requireEmailVerification: true`,
//   which is correct production posture). Per advisor research (Option
//   C), the helper temporarily flips email_verified=true ONLY long
//   enough to perform the sign-in (which mints a real BA-issued
//   cookie), then immediately reverts. `getSession` does NOT re-check
//   emailVerified, so the cookie remains valid for read operations
//   while the row reflects unverified state again — which is exactly
//   what the verification-status test needs to observe.
//
// Production-safety: the owner pool requires DATABASE_URL_OWNER, which
// is contract-test-runner-internal only. ALL non-test callers
// (production clients, third-party integrations) hitting
// /api/auth/sign-in/email for an unverified user STILL receive 403
// EMAIL_NOT_VERIFIED. requireEmailVerification:true is unchanged.
//
// Reverse-patch evidence (D-02): reverting the verified:false branch
// to a no-op (delegating to the verified path) returns assertions 1, 2,
// and 4 to RED — the captured query log is empty (no UPDATE calls), so
// `query` mock receives 0 invocations instead of 2.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pg.Pool must be mocked BEFORE the module under test imports it. We
// expose `mockPool` and `mockQuery` from the factory so each test can
// reset them in beforeEach. The factory signature mirrors the real pg
// surface used by seed/conformance.ts (Pool with .query() and .end()).
const mockQuery = vi.fn();
const mockEnd = vi.fn();
// Pool is invoked with `new`, so the mock must be constructable. A
// vi.fn() with arrow-function impl is NOT — vitest emits a warning and
// throws "is not a constructor". Use vi.fn(function ...) to satisfy the
// `[[Construct]]` slot. The function captures the connection-string arg
// for assertion via PoolCtor.mock.calls.
const PoolCtor = vi.fn(function PoolMock(this: unknown, _opts: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  (this as any).query = mockQuery;
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  (this as any).end = mockEnd;
});
vi.mock("pg", () => ({
  Pool: PoolCtor,
}));

describe("signInFixture — verified:false branch (Phase 02.20 / D-01 — Group I)", () => {
  const ORIGINAL_DATABASE_URL_OWNER = process.env.DATABASE_URL_OWNER;

  beforeEach(() => {
    mockQuery.mockReset();
    mockEnd.mockReset();
    PoolCtor.mockClear();
    // The flip and revert UPDATE both return rowCount=1 in the success
    // path (the seeded `pending@conformance.test` row exists).
    mockQuery.mockResolvedValue({ rowCount: 1 });
    mockEnd.mockResolvedValue(undefined);
    // Required by the helper's owner-pool branch — must be set or the
    // helper throws before ever touching pg / fetch (mirrors the
    // seed/conformance.ts pattern at line 113).
    process.env.DATABASE_URL_OWNER = "postgres://owner:test@postgres:5432/openwhispr_test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (ORIGINAL_DATABASE_URL_OWNER === undefined) {
      delete process.env.DATABASE_URL_OWNER;
    } else {
      process.env.DATABASE_URL_OWNER = ORIGINAL_DATABASE_URL_OWNER;
    }
  });

  it("flips email_verified=true via owner pool, signs in, then reverts to false (success path)", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    // Late import so the vi.mock("pg", ...) above is in place when the
    // module under test resolves its `import { Pool } from "pg"`.
    const { signInFixture } = await import("../sign-in-fixture.js");

    await signInFixture("pending@conformance.test", { verified: false });

    // Pool constructed exactly once with the owner connection string.
    expect(PoolCtor).toHaveBeenCalledTimes(1);
    expect(PoolCtor.mock.calls[0]?.[0]).toMatchObject({
      connectionString: "postgres://owner:test@postgres:5432/openwhispr_test",
    });

    // Two UPDATE statements: flip then revert. Order matters — the flip
    // must happen BEFORE the sign-in fetch and the revert AFTER it.
    expect(mockQuery).toHaveBeenCalledTimes(2);

    const firstCall = mockQuery.mock.calls[0] as [string, unknown[]];
    const secondCall = mockQuery.mock.calls[1] as [string, unknown[]];

    // Flip: SET email_verified = true.
    expect(firstCall[0]).toMatch(/UPDATE\s+users/i);
    expect(firstCall[0]).toMatch(/email_verified\s*=\s*true/i);
    expect(firstCall[1]).toEqual(["pending@conformance.test"]);

    // Revert: SET email_verified = false.
    expect(secondCall[0]).toMatch(/UPDATE\s+users/i);
    expect(secondCall[0]).toMatch(/email_verified\s*=\s*false/i);
    expect(secondCall[1]).toEqual(["pending@conformance.test"]);

    // Pool closed exactly once.
    expect(mockEnd).toHaveBeenCalledTimes(1);

    // Sign-in POST happened between the two UPDATEs.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const fetchCallOrder = fetchSpy.mock.invocationCallOrder[0] ?? 0;
    const flipOrder = mockQuery.mock.invocationCallOrder[0] ?? 0;
    const revertOrder = mockQuery.mock.invocationCallOrder[1] ?? 0;
    expect(flipOrder).toBeLessThan(fetchCallOrder);
    expect(fetchCallOrder).toBeLessThan(revertOrder);
  });

  it("reverts email_verified=false even when the sign-in POST throws (try/finally guarantee)", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { signInFixture } = await import("../sign-in-fixture.js");

    await expect(signInFixture("pending@conformance.test", { verified: false })).rejects.toThrow();

    // Both flip AND revert must have run despite the fetch throw.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1]?.[0]).toMatch(/email_verified\s*=\s*false/i);
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it("reverts email_verified=false even when sign-in returns non-2xx (try/finally guarantee)", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "INVALID_EMAIL_OR_PASSWORD" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { signInFixture } = await import("../sign-in-fixture.js");

    await expect(signInFixture("pending@conformance.test", { verified: false })).rejects.toThrow();

    // Revert MUST run on the failure path so the row is left in its
    // original unverified state regardless of sign-in outcome.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1]?.[0]).toMatch(/email_verified\s*=\s*false/i);
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error when DATABASE_URL_OWNER is not set (helper guard)", async () => {
    delete process.env.DATABASE_URL_OWNER;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { signInFixture } = await import("../sign-in-fixture.js");

    await expect(signInFixture("pending@conformance.test", { verified: false })).rejects.toThrow(
      /DATABASE_URL_OWNER/,
    );

    // Helper must NOT have constructed a pool or hit the network.
    expect(PoolCtor).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does NOT touch the owner pool on the verified path (default opts)", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { signInFixture } = await import("../sign-in-fixture.js");

    await signInFixture("verified@conformance.test");

    // No pool, no UPDATEs — verified path is unchanged from Phase 02.18.
    expect(PoolCtor).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockEnd).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
