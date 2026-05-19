// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-05 / Plan 55-05 — `/api/_test/reset-setup` route unit tests.
//
// The setup-wizard e2e spec needs a hermetic way to flip the singleton
// `setup_state` row back to 'pending' between runs (the slim dev-tools
// instance bootstraps with 'completed' so /setup redirects). This
// endpoint MUST exist when NODE_ENV='test' OR
// OPENWHISPR_TEST_ROUTES='true' and MUST 404 in production. It is the
// only mutation seam: the wizard's idempotent INSERT handles the user
// row, so the route only resets the singleton.
//
// Coverage matrix:
//   Test 1: NODE_ENV='production' (no OPENWHISPR_TEST_ROUTES) → 404.
//   Test 2: NODE_ENV='test' → POST returns 200 + {ok:true} and issues
//           an UPSERT against setup_state setting status='pending' and
//           completed_at=NULL.
//   Test 3: NODE_ENV='production' + OPENWHISPR_TEST_ROUTES='true' →
//           route registered (compose dev-tools / contract-test parity).
//   Test 4: Route is unauthenticated — no Authorization header still
//           reaches the handler. The wizard runs while signed-out so
//           authentication on the reset path would make the seam
//           unusable.
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { buildTestOnlyRoutes } from "../../../src/routes/test-only.js";

function makeRecordingDb() {
  const recorded: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    async execute(query: unknown): Promise<unknown> {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const params: unknown[] = [];
      const parts: string[] = [];
      for (const c of chunks) {
        if (typeof c === "string") {
          parts.push(c);
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
      return { rows: [] };
    },
  };
  return {
    db: {
      async transaction<T>(cb: (t: typeof tx) => Promise<T>): Promise<T> {
        return cb(tx);
      },
      // Direct execute path (without explicit transaction wrapper) — the
      // setup-reset handler issues a single UPSERT and may bypass the tx
      // helper. Mirror the recording surface.
      async execute(query: unknown): Promise<unknown> {
        return tx.execute(query);
      },
    },
    recorded,
  };
}

function makeFakeAuth() {
  return {
    handler: vi.fn(),
    api: { getSession: vi.fn(async () => null) },
  };
}

function buildLocalApp(fakeDb: ReturnType<typeof makeRecordingDb>["db"]): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  // Reset-setup is intentionally unauthenticated — no onRequest hook
  // populating req.user. The route MUST handle the no-session case
  // without crashing.
  const fakeAuth = makeFakeAuth();
  app.register(
    buildTestOnlyRoutes({
      auth: fakeAuth as unknown as Parameters<typeof buildTestOnlyRoutes>[0]["auth"],
      db: fakeDb as unknown as Parameters<typeof buildTestOnlyRoutes>[0]["db"],
    }),
  );
  return app;
}

describe("/api/_test/reset-setup (Phase 55-05)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Test 1: returns 404 when NODE_ENV != 'test' and OPENWHISPR_TEST_ROUTES != 'true'", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "false");
    const { db } = makeRecordingDb();
    const app = buildLocalApp(db);
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/_test/reset-setup" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("Test 2: NODE_ENV='test' → POST 200 {ok:true} + setup_state UPSERT to 'pending'", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { db, recorded } = makeRecordingDb();
    const app = buildLocalApp(db);
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/_test/reset-setup" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    // The handler must have issued an UPSERT against setup_state
    // flipping status back to 'pending' and clearing completed_at.
    const upsert = recorded.find(
      (q) =>
        /INSERT\s+INTO\s+setup_state/i.test(q.sql) &&
        /pending/i.test(q.sql) &&
        /ON\s+CONFLICT/i.test(q.sql),
    );
    expect(upsert, "expected INSERT INTO setup_state ... ON CONFLICT").toBeTruthy();
    expect(upsert?.sql).toMatch(/completed_at\s*=\s*NULL/i);
    await app.close();
  });

  it("Test 3: OPENWHISPR_TEST_ROUTES='true' overrides NODE_ENV gate (compose parity)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const { db } = makeRecordingDb();
    const app = buildLocalApp(db);
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/_test/reset-setup" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("Test 4: handler is unauthenticated — no Authorization header still succeeds", async () => {
    // The wizard runs while signed-out so the reset endpoint MUST NOT
    // require a bearer. This is the inverse of force-rotate/health-authed.
    vi.stubEnv("NODE_ENV", "test");
    const { db } = makeRecordingDb();
    const app = buildLocalApp(db);
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/reset-setup",
      // intentionally no headers
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
