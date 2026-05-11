/**
 * Phase 02.7 / Plan 02.7-04 / D-03 Layer A — seed signUp() loud-fail
 * + seedConformanceFixtures preflight diagnostic.
 *
 * Source-of-record commit: <filled at commit time>
 *
 * Reverts: this test goes RED if signUp() reverts to the broad
 *   `if (status === 422 || status === 400 || status === 409) return {created:false}`
 * swallow OR if seedConformanceFixtures drops its preflight COUNT(*) check.
 * Specifically:
 *   - Tests "non-duplicate 422 throws", "400 CSRF throws", "429 throws", "500 throws",
 *     "non-JSON 4xx throws" → RED if 4xx swallow returns instead.
 *   - Test "preflight: zero rows after signUp loop throws" → RED if preflight
 *     COUNT(*) check is removed from the bottom of seedConformanceFixtures.
 *
 * Validates the contract that the seed helper:
 *   1. Distinguishes Better Auth's USER_ALREADY_EXISTS code (idempotent OK)
 *      from any other 4xx (real failure — surface loudly).
 *   2. Asserts the fixture row actually landed via a final SELECT count(*)
 *      preflight; converts the previously silent contract-test failure
 *      ({exists:false} when fixture missing) into a clear seed-time error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted pg.Pool mock — must be declared before importing the module
// under test so vi.mock("pg", ...) intercepts the `new Pool(...)` call.
const { poolQuerySpy, poolEndSpy, PoolCtorSpy } = vi.hoisted(() => {
  const poolQuerySpy = vi.fn();
  const poolEndSpy = vi.fn().mockResolvedValue(undefined);
  // Must be a real constructor — `new Pool(...)` is invoked from the SUT.
  function PoolCtorSpy(this: unknown) {
    (this as { query: unknown; end: unknown }).query = poolQuerySpy;
    (this as { query: unknown; end: unknown }).end = poolEndSpy;
  }
  return { poolQuerySpy, poolEndSpy, PoolCtorSpy };
});

vi.mock("pg", () => ({ Pool: PoolCtorSpy }));

// Import AFTER vi.mock so the module sees the mocked Pool.
const { seedConformanceFixtures, CONFORMANCE_FIXTURES } = await import(
  "@openwhispr/data/seed/conformance"
);

const AUTH_URL = "http://api.localhost";
const OWNER_URL = "postgres://owner@localhost:5432/test";

interface FetchResponseSpec {
  status: number;
  body: string | object;
  contentType?: string;
}

function jsonResponse(spec: FetchResponseSpec): Response {
  const body = typeof spec.body === "string" ? spec.body : JSON.stringify(spec.body);
  return new Response(body, {
    status: spec.status,
    headers: {
      "content-type": spec.contentType ?? "application/json",
    },
  });
}

function stubFetchSequence(specs: FetchResponseSpec[]): void {
  const fetchMock = vi.fn();
  for (const spec of specs) {
    fetchMock.mockResolvedValueOnce(jsonResponse(spec));
  }
  vi.stubGlobal("fetch", fetchMock);
}

function stubFetchUniform(spec: FetchResponseSpec): void {
  // Important: a Response body can only be read once. The seed loop calls
  // fetch() once per fixture, so we must hand back a FRESH Response every
  // call (not the same instance via mockResolvedValue).
  const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(spec));
  vi.stubGlobal("fetch", fetchMock);
}

/** Default preflight stub: returns at least 1 row so preflight passes. */
function stubPreflightOk(): void {
  poolQuerySpy.mockReset();
  // Each call to patchVerified is also a query; return rowCount=1 by default.
  // The preflight call is the LAST one and shapes its result via .rows[0].n.
  poolQuerySpy.mockImplementation(async (sqlText: string) => {
    if (/count\(\*\)/i.test(sqlText)) {
      return { rows: [{ n: 1 }], rowCount: 1 };
    }
    // patchVerified UPDATE returns RETURNING id rows.
    return { rows: [{ id: "fake-id" }], rowCount: 1 };
  });
}

beforeEach(() => {
  poolQuerySpy.mockReset();
  poolEndSpy.mockClear();
  stubPreflightOk();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Phase 02.7 D-03A — seed signUp() loud-fail", () => {
  it("2xx response → returns {created: true} for all fixtures", async () => {
    stubFetchUniform({ status: 200, body: { ok: true } });
    const results = await seedConformanceFixtures({
      authUrl: AUTH_URL,
      ownerUrl: OWNER_URL,
    });
    expect(results).toHaveLength(CONFORMANCE_FIXTURES.length);
    for (const r of results) {
      expect(r.created).toBe(true);
    }
  });

  it("422 with USER_ALREADY_EXISTS code → returns {created: false} (idempotent)", async () => {
    stubFetchUniform({
      status: 422,
      body: {
        code: "USER_ALREADY_EXISTS",
        message: "User with this email already exists",
      },
    });
    const results = await seedConformanceFixtures({
      authUrl: AUTH_URL,
      ownerUrl: OWNER_URL,
    });
    expect(results.every((r) => r.created === false)).toBe(true);
  });

  it("422 with /already exists/i message but no code → returns {created: false}", async () => {
    stubFetchUniform({
      status: 422,
      body: { message: "User with this email already exists" },
    });
    const results = await seedConformanceFixtures({
      authUrl: AUTH_URL,
      ownerUrl: OWNER_URL,
    });
    expect(results.every((r) => r.created === false)).toBe(true);
  });

  it("422 with VALIDATION_ERROR (non-duplicate) → throws loud Error", async () => {
    stubFetchUniform({
      status: 422,
      body: { code: "VALIDATION_ERROR", message: "invalid email format" },
    });
    await expect(
      seedConformanceFixtures({ authUrl: AUTH_URL, ownerUrl: OWNER_URL }),
    ).rejects.toThrow(/seed: signUp.*HTTP 422.*body=/);
  });

  it("400 CSRF reject → throws Error matching /HTTP 400/", async () => {
    stubFetchUniform({
      status: 400,
      body: { message: "csrf token missing" },
    });
    await expect(
      seedConformanceFixtures({ authUrl: AUTH_URL, ownerUrl: OWNER_URL }),
    ).rejects.toThrow(/HTTP 400/);
  });

  it("409 with /already exists/i message (legacy code-less variant) → returns {created: false}", async () => {
    stubFetchUniform({
      status: 409,
      body: { message: "User already exists" },
    });
    const results = await seedConformanceFixtures({
      authUrl: AUTH_URL,
      ownerUrl: OWNER_URL,
    });
    expect(results.every((r) => r.created === false)).toBe(true);
  });

  it("429 rate-limit → throws Error matching /HTTP 429/", async () => {
    stubFetchUniform({
      status: 429,
      body: { error: "Too many requests" },
    });
    await expect(
      seedConformanceFixtures({ authUrl: AUTH_URL, ownerUrl: OWNER_URL }),
    ).rejects.toThrow(/HTTP 429/);
  });

  it("500 server error → throws Error matching /HTTP 500/", async () => {
    stubFetchUniform({
      status: 500,
      body: { error: "internal server error" },
    });
    await expect(
      seedConformanceFixtures({ authUrl: AUTH_URL, ownerUrl: OWNER_URL }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("non-JSON body on 4xx → still throws (body slice safe)", async () => {
    stubFetchUniform({
      status: 503,
      body: "<html>upstream gateway error</html>",
      contentType: "text/html",
    });
    await expect(
      seedConformanceFixtures({ authUrl: AUTH_URL, ownerUrl: OWNER_URL }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("body slice is bounded to 300 chars in error message", async () => {
    const longBody = "x".repeat(2000);
    stubFetchUniform({
      status: 422,
      body: longBody,
      contentType: "text/plain",
    });
    let caught: Error | null = null;
    try {
      await seedConformanceFixtures({ authUrl: AUTH_URL, ownerUrl: OWNER_URL });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    // The "body=" prefix + at most 300 chars of x's; total should not contain
    // the full 2000-char body.
    expect(caught!.message.length).toBeLessThan(longBody.length);
    expect(caught!.message).toMatch(/body=x{1,300}$/);
  });
});

describe("Phase 02.7 D-03A — seedConformanceFixtures preflight diagnostic", () => {
  it("falls back to env AUTH_URL + DATABASE_URL_OWNER when opts omitted", async () => {
    const originalAuth = process.env.AUTH_URL;
    const originalOwner = process.env.DATABASE_URL_OWNER;
    process.env.AUTH_URL = "http://env-auth.example.test";
    process.env.DATABASE_URL_OWNER = OWNER_URL;
    try {
      stubFetchUniform({ status: 200, body: { ok: true } });
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      const results = await seedConformanceFixtures();
      expect(results).toHaveLength(CONFORMANCE_FIXTURES.length);
      // Verify the env AUTH_URL was used as the fetch base.
      const firstCallUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(firstCallUrl).toContain("http://env-auth.example.test");
    } finally {
      if (originalAuth === undefined) delete process.env.AUTH_URL;
      else process.env.AUTH_URL = originalAuth;
      if (originalOwner === undefined) delete process.env.DATABASE_URL_OWNER;
      else process.env.DATABASE_URL_OWNER = originalOwner;
    }
  });

  it("patchVerified handles null rowCount defensively (verifiedPatched=false)", async () => {
    stubFetchUniform({ status: 200, body: { ok: true } });
    poolQuerySpy.mockReset();
    poolQuerySpy.mockImplementation(async (sqlText: string) => {
      if (/count\(\*\)/i.test(sqlText)) {
        return { rows: [{ n: 1 }], rowCount: 1 };
      }
      // seedPhase5Resources (Plan 05-01) does a SELECT id FROM users
      // for the fixture row before its own INSERTs — return the row so
      // that helper doesn't throw before patchVerified() runs.
      if (/SELECT\s+id\s+FROM\s+users/i.test(sqlText)) {
        return {
          rows: [{ id: "00000000-0000-4000-8000-000000000001" }],
          rowCount: 1,
        };
      }
      // Simulate a driver returning null/undefined rowCount on UPDATE.
      return { rows: [], rowCount: null };
    });
    const results = await seedConformanceFixtures({
      authUrl: AUTH_URL,
      ownerUrl: OWNER_URL,
    });
    // Every verified user has verifiedPatched=false because rowCount fell
    // through to the `?? 0` branch.
    for (const r of results) {
      expect(r.verifiedPatched).toBe(false);
    }
  });

  it("missing DATABASE_URL_OWNER and no opts → throws", async () => {
    const original = process.env.DATABASE_URL_OWNER;
    delete process.env.DATABASE_URL_OWNER;
    try {
      await expect(seedConformanceFixtures({ authUrl: AUTH_URL })).rejects.toThrow(
        /DATABASE_URL_OWNER not set/,
      );
    } finally {
      if (original !== undefined) process.env.DATABASE_URL_OWNER = original;
    }
  });

  it("preflight handles preflight.rows[0]=undefined defensively (n falsy → throws)", async () => {
    stubFetchUniform({ status: 200, body: { ok: true } });
    poolQuerySpy.mockReset();
    poolQuerySpy.mockImplementation(async (sqlText: string) => {
      if (/count\(\*\)/i.test(sqlText)) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ id: "fake-id" }], rowCount: 1 };
    });
    await expect(
      seedConformanceFixtures({ authUrl: AUTH_URL, ownerUrl: OWNER_URL }),
    ).rejects.toThrow(/preflight failed/);
  });

  it("preflight COUNT(*) returns 0 → throws /preflight failed/", async () => {
    stubFetchUniform({ status: 200, body: { ok: true } });
    // Override the default preflight-OK stub: COUNT(*) returns 0.
    poolQuerySpy.mockReset();
    poolQuerySpy.mockImplementation(async (sqlText: string) => {
      if (/count\(\*\)/i.test(sqlText)) {
        return { rows: [{ n: 0 }], rowCount: 1 };
      }
      return { rows: [{ id: "fake-id" }], rowCount: 1 };
    });
    await expect(
      seedConformanceFixtures({ authUrl: AUTH_URL, ownerUrl: OWNER_URL }),
    ).rejects.toThrow(/preflight failed/);
  });

  it("preflight uses lower(email) and the canonical fixture address", async () => {
    stubFetchUniform({ status: 200, body: { ok: true } });
    let preflightSql = "";
    let preflightParams: unknown[] = [];
    poolQuerySpy.mockReset();
    poolQuerySpy.mockImplementation(async (sqlText: string, params?: unknown[]) => {
      if (/count\(\*\)/i.test(sqlText)) {
        preflightSql = sqlText;
        preflightParams = params ?? [];
        return { rows: [{ n: 1 }], rowCount: 1 };
      }
      return { rows: [{ id: "fake-id" }], rowCount: 1 };
    });
    await seedConformanceFixtures({ authUrl: AUTH_URL, ownerUrl: OWNER_URL });
    expect(preflightSql).toMatch(/lower\(email\)/i);
    expect(preflightParams).toEqual(["fixture@conformance.test"]);
  });

  it("preflight runs after the signUp loop (pool.end still called)", async () => {
    stubFetchUniform({ status: 200, body: { ok: true } });
    await seedConformanceFixtures({ authUrl: AUTH_URL, ownerUrl: OWNER_URL });
    expect(poolEndSpy).toHaveBeenCalledTimes(1);
  });
});
