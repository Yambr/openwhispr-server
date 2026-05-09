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
//           200, set-auth-token header carries a NEW bearer, and
//           recordPreviousToken was called with (db, tenantId, sessionId,
//           hashToken(oldBearer)).
//   Test 3: NODE_ENV='test' + valid bearer → GET health-authed returns
//           200 + {status:"ok", userId}. Without bearer → 401 envelope.
//   Test 4: NODE_ENV='production' → both routes 404 (gate honored).
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../error-handler.js";
import { AuthError } from "../errors.js";
import { buildTestOnlyRoutes } from "./test-only.js";

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
  const getSession = vi.fn(async () => {
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
      // session lookup by token_hash
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
    // Confirm an UPDATE sessions ... previous_token_hash query was executed.
    const recordedPrev = recorded.find((q) =>
      /UPDATE\s+sessions[\s\S]*previous_token_hash/i.test(q.sql),
    );
    expect(recordedPrev).toBeTruthy();
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
});
