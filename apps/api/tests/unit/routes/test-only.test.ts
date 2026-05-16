// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 08 / Task 2 — `/api/_test/*` route unit tests.
//
// These two routes are consumed by
// packages/contract-tests/src/token-rotation.test.ts to drive the
// AUTH-04 overlap window. They MUST exist when NODE_ENV='test' and MUST
// NOT be present in any other environment (production, dev, staging).
//
// Coverage matrix:
//   Test 1: NODE_ENV !== 'test' → routes 404.
//   Test 2: NODE_ENV='test' + valid bearer → POST force-rotate returns
//           200, set-auth-token header carries a NEW bearer, and an
//           UPDATE sessions ... previous_token (plain, post-02.12) query
//           was issued.
//   Test 3: NODE_ENV='test' + valid bearer → GET health-authed returns
//           200 + {status:"ok", userId}. Without bearer → 401 envelope.
//   Test 4: NODE_ENV='production' → both routes 404 (gate honored).
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { AuthError } from "../../../src/errors.js";
import { buildTestOnlyRoutes } from "../../../src/routes/test-only.js";

interface FakeUser {
  id: string;
  email: string;
  tenantId: string;
}

const FAKE_USER: FakeUser = {
  id: "user-fixture",
  email: "rotation-test@local",
  tenantId: "00000000-0000-0000-0000-000000000000",
};
const FAKE_SESSION_ID = "11111111-2222-3333-4444-555555555555";

interface FakeAuthOpts {
  withSession?: boolean;
  newBearer?: string;
}

function makeFakeAuth(opts: FakeAuthOpts = {}) {
  const newBearer = opts.newBearer ?? "NEW_OPAQUE_BEARER_xyz";
  const handler = vi.fn(async () => {
    return new Response(JSON.stringify({ rotated: true }), {
      status: 200,
      headers: { "set-auth-token": newBearer, "content-type": "application/json" },
    });
  });
  const getSession = vi.fn(async (_args: { headers: Headers }) => {
    void _args;
    if (!opts.withSession) return null;
    return { user: FAKE_USER };
  });
  return {
    handler,
    api: { getSession },
  };
}

function makeFakeDb() {
  const recorded: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    async execute(query: unknown): Promise<unknown> {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const params: unknown[] = [];
      const parts: string[] = [];
      for (const c of chunks) {
        if (typeof c === "string") {
          parts.push("?");
          params.push(c);
        } else if (c && typeof c === "object" && "value" in c) {
          const v = (c as { value: unknown }).value;
          if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
            parts.push((v as string[]).join(""));
          } else {
            parts.push("?");
            params.push(v);
          }
        }
      }
      const text = parts.join("");
      recorded.push({ sql: text, params });
      // session lookup by token (plain text, post-02.12)
      if (/SELECT\s+id.*FROM\s+sessions/i.test(text)) {
        return { rows: [{ id: FAKE_SESSION_ID }] };
      }
      return { rows: [] };
    },
  };
  return {
    db: {
      async transaction<T>(cb: (t: typeof tx) => Promise<T>): Promise<T> {
        return cb(tx);
      },
    },
    recorded,
  };
}

interface BuildAppOpts {
  authed?: boolean;
  fakeAuth?: ReturnType<typeof makeFakeAuth>;
  fakeDb?: ReturnType<typeof makeFakeDb>["db"];
}

function buildLocalApp(opts: BuildAppOpts = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  const fakeAuth = opts.fakeAuth ?? makeFakeAuth({ withSession: !!opts.authed });
  const fakeDb = opts.fakeDb ?? makeFakeDb().db;
  // Minimal auth hook stand-in: populates req.user/req.tenant if the
  // fake getSession returns a session, throws otherwise.
  app.addHook("onRequest", async (req) => {
    if (req.routeOptions?.config?.auth === false) return;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
    }
    const session = await fakeAuth.api.getSession({ headers });
    if (!session) {
      throw new AuthError("unauthorized");
    }
    (req as unknown as { user: FakeUser }).user = session.user;
    (req as unknown as { tenant: string }).tenant = session.user.tenantId;
    (req as unknown as { sessionId: string }).sessionId = FAKE_SESSION_ID;
  });
  app.register(
    buildTestOnlyRoutes({
      auth: fakeAuth as unknown as Parameters<typeof buildTestOnlyRoutes>[0]["auth"],
      db: fakeDb as unknown as Parameters<typeof buildTestOnlyRoutes>[0]["db"],
    }),
  );
  return app;
}

describe("test-only routes (NODE_ENV=test gated)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Test 1: registers no routes when NODE_ENV is not 'test'", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const app = buildLocalApp({ authed: true });
    await app.ready();
    const r1 = await app.inject({
      method: "POST",
      url: "/api/_test/force-rotate",
      headers: { authorization: "Bearer OLD_TOKEN" },
    });
    expect(r1.statusCode).toBe(404);
    const r2 = await app.inject({
      method: "GET",
      url: "/api/_test/health-authed",
      headers: { authorization: "Bearer OLD_TOKEN" },
    });
    expect(r2.statusCode).toBe(404);
    await app.close();
  });

  it("Test 2: POST force-rotate returns 200 with NEW set-auth-token, records previous", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const fakeAuth = makeFakeAuth({ withSession: true, newBearer: "NEW_BEARER_AAA" });
    const { db, recorded } = makeFakeDb();
    const app = buildLocalApp({ authed: true, fakeAuth, fakeDb: db });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/force-rotate",
      headers: { authorization: "Bearer OLD_BEARER_xyz" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["set-auth-token"]).toBe("NEW_BEARER_AAA");
    expect(res.headers["set-auth-token"]).not.toBe("OLD_BEARER_xyz");
    // Phase 33 / Plan 33-05 — plaintext `previous_token` column was
    // dropped by migration 0020 (LOCKER-08 / envelope encryption). The
    // 5-minute overlap CONTRACT survives via the SHA-256 fingerprint
    // sidecar `previous_token_fp` written by `recordPreviousToken`. The
    // assertion below was originally `previous_token` (plain) — retarget
    // to `previous_token_fp` and assert the legacy plain column NEVER
    // appears in the issued SQL (defense-in-depth at the call-site).
    const recordedPrev = recorded.find((q) =>
      /UPDATE\s+sessions[\s\S]*previous_token_fp\b/i.test(q.sql),
    );
    expect(recordedPrev).toBeTruthy();
    expect(recordedPrev?.sql).not.toMatch(/previous_token_hash/);
    expect(recordedPrev?.sql).not.toMatch(/\bprevious_token\s*=\s*\?/);
    await app.close();
  });

  it("Test 3a: GET health-authed returns 200 with userId when bearer valid", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const app = buildLocalApp({ authed: true });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/_test/health-authed",
      headers: { authorization: "Bearer GOOD" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", userId: FAKE_USER.id });
    await app.close();
  });

  it("Test 3b: GET health-authed returns 401 envelope when no bearer", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const app = buildLocalApp({ authed: false });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/_test/health-authed",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
    await app.close();
  });

  it("Test 4: NODE_ENV='production' returns 404 on health-authed (gate honored)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const app = buildLocalApp({ authed: true });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/_test/health-authed",
      headers: { authorization: "Bearer X" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  // Phase 03 / Plan 10 — PROVIDER-01 introspection seam.
  it("Test 5: GET /api/_test/litellm-baseurl returns the LiteLLM client baseUrl when wired", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    const fakeAuth = makeFakeAuth({ withSession: true });
    const fakeDb = makeFakeDb().db;
    const fakeLitellm = {
      baseUrl: "https://corporate-litellm.example.com",
    } as unknown as Parameters<typeof buildTestOnlyRoutes>[0]["litellm"];
    app.register(
      buildTestOnlyRoutes({
        auth: fakeAuth as unknown as Parameters<typeof buildTestOnlyRoutes>[0]["auth"],
        db: fakeDb as unknown as Parameters<typeof buildTestOnlyRoutes>[0]["db"],
        litellm: fakeLitellm,
      }),
    );
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/_test/litellm-baseurl",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ baseUrl: "https://corporate-litellm.example.com" });
    await app.close();
  });

  it("Test 5b: /api/_test/litellm-baseurl returns 404 when litellm dep is omitted", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const app = buildLocalApp({ authed: true });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/_test/litellm-baseurl",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  // ----- Stage B back-fill — close coverage gaps to 90/90/90/90 ----------

  it("Test 6: NODE_ENV=production + OPENWHISPR_TEST_ROUTES=true ALSO registers the routes", async () => {
    // Pins line 127 cond-expr idx 1 (the OR fallback). The compose
    // contract-test stack uses this opt-in to expose force-rotate while
    // running with NODE_ENV=production for deploy-posture parity.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const app = buildLocalApp({ authed: true });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/_test/health-authed",
      headers: { authorization: "Bearer X" },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("Test 7: force-rotate falls back to DB shortcut when auth.handler throws", async () => {
    // Pins lines 195-197 (catch + fallthrough) + 200-203 (rotateSessionInDb).
    vi.stubEnv("NODE_ENV", "test");
    const fakeAuth = {
      handler: vi.fn(async () => {
        throw new Error("no rotation seam in this build");
      }),
      api: {
        getSession: vi.fn(async () => ({ user: FAKE_USER })),
      },
    };
    const { db, recorded } = makeFakeDb();
    const app = buildLocalApp({ authed: true, fakeAuth, fakeDb: db });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/force-rotate",
      headers: { authorization: "Bearer OLD_BEARER_xyz" },
    });
    expect(res.statusCode).toBe(200);
    // The DB shortcut must have run — the UPDATE sessions row carries
    // BOTH previous_token AND a fresh `token` value.
    const update = recorded.find((q) =>
      /UPDATE\s+sessions[\s\S]*previous_token[\s\S]*token\s*=/i.test(q.sql),
    );
    expect(update).toBeTruthy();
    expect(res.headers["set-auth-token"]).toBeTruthy();
    expect(res.headers["set-auth-token"]).not.toBe("OLD_BEARER_xyz");
    await app.close();
  });

  it("Test 8: force-rotate falls back to DB when handler returns a non-rotation response", async () => {
    // auth.handler returns 200 but with NO set-auth-token header — the
    // route must fall through to the DB shortcut (line 200 `if !newBearer`).
    vi.stubEnv("NODE_ENV", "test");
    const fakeAuth = {
      handler: vi.fn(async () => new Response(null, { status: 200 })),
      api: {
        getSession: vi.fn(async () => ({ user: FAKE_USER })),
      },
    };
    const { db, recorded } = makeFakeDb();
    const app = buildLocalApp({ authed: true, fakeAuth, fakeDb: db });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/force-rotate",
      headers: { authorization: "Bearer OLD_DEFAULT" },
    });
    expect(res.statusCode).toBe(200);
    // DB shortcut must have written a NEW token.
    const update = recorded.find((q) => /UPDATE\s+sessions[\s\S]*previous_token/i.test(q.sql));
    expect(update).toBeTruthy();
    await app.close();
  });

  it("Test 9: force-rotate returns 401 envelope when no Authorization bearer is present", async () => {
    // Pins line 158 — `if (!oldBearer ...)`. The onRequest hook still
    // populates req.user via the fake session; the absent header is the
    // discriminator. We use a non-handler auth so getSession admits the
    // request unconditionally.
    vi.stubEnv("NODE_ENV", "test");
    const fakeAuth = {
      handler: vi.fn(),
      api: {
        getSession: vi.fn(async () => ({ user: FAKE_USER })),
      },
    };
    const app = buildLocalApp({ authed: true, fakeAuth });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/force-rotate",
      // No `authorization` header.
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
    await app.close();
  });

  it("Test 10: force-rotate returns 401 envelope when bearer doesn't match any session row", async () => {
    // Pins line 167-169 — sessionId resolution fails after lookup.
    vi.stubEnv("NODE_ENV", "test");
    const fakeAuth = {
      handler: vi.fn(),
      api: {
        getSession: vi.fn(async () => ({ user: FAKE_USER })),
      },
    };
    // DB returns no rows for the SELECT id FROM sessions lookup.
    const fakeDb = {
      async transaction<T>(cb: (t: unknown) => Promise<T>): Promise<T> {
        return cb({
          execute: async () => ({ rows: [] }),
        });
      },
    } as unknown as Parameters<typeof buildTestOnlyRoutes>[0]["db"];
    // We need the onRequest hook to NOT pre-stash sessionId so the route
    // falls into the DB lookup branch. Build a custom app.
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    app.addHook("onRequest", async (req) => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
      }
      const session = await fakeAuth.api.getSession({ headers });
      if (!session) throw new AuthError("unauthorized");
      (req as unknown as { user: FakeUser }).user = session.user;
      (req as unknown as { tenant: string }).tenant = session.user.tenantId;
      // Intentionally NOT setting sessionId — route must do its own lookup.
    });
    app.register(
      buildTestOnlyRoutes({
        auth: fakeAuth as unknown as Parameters<typeof buildTestOnlyRoutes>[0]["auth"],
        db: fakeDb,
      }),
    );
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/force-rotate",
      headers: { authorization: "Bearer NO_MATCH" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "session not found" });
    await app.close();
  });

  it("Test 11: extractBearer rejects malformed authorization headers (e.g. 'Basic ...')", async () => {
    // Indirectly pins extractBearer's no-match branch (line 77) via a
    // request whose Authorization is non-Bearer. The route then fails
    // closed at line 158 → 401.
    vi.stubEnv("NODE_ENV", "test");
    const fakeAuth = {
      handler: vi.fn(),
      api: {
        getSession: vi.fn(async () => ({ user: FAKE_USER })),
      },
    };
    const app = buildLocalApp({ authed: true, fakeAuth });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/force-rotate",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
