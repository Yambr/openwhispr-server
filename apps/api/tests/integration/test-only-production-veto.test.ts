// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 57 / Track C — api-routes-rest:CR-02 + CR-03 regression guard.
//
// CR-02 (/api/_test/reset-setup re-opens the admin claim window) and
// CR-03 (/api/_test/force-rotate forces an unauthenticated session
// rotation) both relied solely on the operator-controlled
// OPENWHISPR_TEST_ROUTES env flag for production safety. A misset
// OPENWHISPR_TEST_ROUTES=true in a production deploy registered the
// whole /api/_test/* plugin.
//
// The fix lifts the NODE_ENV='production' veto to the
// plugin-registration gate: the plugin REFUSES to register ANY route
// when NODE_ENV='production', regardless of OPENWHISPR_TEST_ROUTES.
//
// Coverage:
//   - production + OPENWHISPR_TEST_ROUTES=true → every /api/_test/* route 404.
//   - test + OPENWHISPR_TEST_ROUTES=true → routes register (asymmetry pin).
import crypto from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../src/error-handler.js";
import { AuthError } from "../../src/errors.js";
import { buildTestOnlyRoutes, type TestOnlyDeps } from "../../src/routes/test-only.js";

const FAKE_USER = {
  id: "user-fixture",
  email: "veto-test@local",
  tenantId: "00000000-0000-0000-0000-000000000000",
};
const FAKE_SESSION_ID = "11111111-2222-3333-4444-555555555555";

/** Minimal fake DB — every query yields one session row so force-rotate
 *  + reset-setup execute without throwing in the test-mode positive case. */
function makeFakeDb() {
  const tx = {
    async execute(query: unknown): Promise<unknown> {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const parts: string[] = [];
      for (const c of chunks) {
        if (typeof c === "string") parts.push(c);
        else if (c && typeof c === "object" && "value" in c) {
          const v = (c as { value: unknown }).value;
          if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
            parts.push((v as string[]).join(""));
          }
        }
      }
      const text = parts.join("");
      if (/SELECT\s+id.*FROM\s+sessions/i.test(text)) {
        return { rows: [{ id: FAKE_SESSION_ID }] };
      }
      return { rows: [] };
    },
  };
  return {
    async transaction<T>(cb: (t: typeof tx) => Promise<T>): Promise<T> {
      return cb(tx);
    },
  };
}

function makeFakeAuth() {
  return {
    handler: vi.fn(
      async () =>
        new Response(JSON.stringify({ rotated: true }), {
          status: 200,
          headers: { "set-auth-token": "NEW_BEARER", "content-type": "application/json" },
        }),
    ),
    api: {
      getSession: vi.fn(async () => ({ user: FAKE_USER })),
      signUpEmail: vi.fn(async () => ({
        data: { user: { id: FAKE_USER.id, email: FAKE_USER.email } },
        error: null,
      })),
    },
  };
}

/** Build a Fastify app with the test-only plugin registered with FULL
 *  deps (auth + db + litellm + signUpEmail) so every route — including
 *  litellm-baseurl and seed-tenant — would register under a non-prod env. */
function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  const fakeAuth = makeFakeAuth();
  app.addHook("onRequest", async (req) => {
    if (req.routeOptions?.config?.auth === false) return;
    const session = await fakeAuth.api.getSession();
    if (!session) throw new AuthError("unauthorized");
    (req as unknown as { user: typeof FAKE_USER }).user = session.user;
    (req as unknown as { tenant: string }).tenant = session.user.tenantId;
    (req as unknown as { sessionId: string }).sessionId = FAKE_SESSION_ID;
  });
  const deps: TestOnlyDeps = {
    auth: fakeAuth as unknown as TestOnlyDeps["auth"],
    db: makeFakeDb() as unknown as TestOnlyDeps["db"],
    litellm: { baseUrl: "https://litellm.example.com" } as unknown as TestOnlyDeps["litellm"],
    signUpEmail: fakeAuth.api.signUpEmail as unknown as TestOnlyDeps["signUpEmail"],
  };
  app.register(buildTestOnlyRoutes(deps));
  return app;
}

// Every /api/_test/* path the plugin declares, plus the HTTP method
// the route handler binds.
const ROUTES: ReadonlyArray<{ method: "GET" | "POST"; url: string }> = [
  { method: "GET", url: "/api/_test/litellm-baseurl" },
  { method: "POST", url: "/api/_test/force-rotate" },
  { method: "GET", url: "/api/_test/health-authed" },
  { method: "GET", url: "/api/_test/route-list" },
  { method: "POST", url: "/api/_test/reset-setup" },
  {
    method: "POST",
    url: "/api/_test/seed-tenant",
  },
];

describe("test-only routes — production veto (api-routes-rest:CR-02 + CR-03)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("api-routes-rest:CR-02 + CR-03 — /api/_test/* refuses on NODE_ENV=production", async () => {
    // Misset OPENWHISPR_TEST_ROUTES=true in a production deploy MUST NOT
    // resurrect any /api/_test/* route.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const app = buildApp();
    await app.ready();
    for (const { method, url } of ROUTES) {
      const res = await app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${crypto.randomBytes(8).toString("hex")}` },
      });
      expect(res.statusCode, `${method} ${url} must 404 in production`).toBe(404);
    }
    await app.close();
  });

  it("api-routes-rest:CR-02 + CR-03 — /api/_test/* serves on NODE_ENV=test", async () => {
    // Asymmetry pin: test-mode behavior is unchanged — every route is
    // reachable (i.e. NOT 404; the route handler runs).
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
    const app = buildApp();
    await app.ready();
    for (const { method, url } of ROUTES) {
      const res = await app.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${crypto.randomBytes(8).toString("hex")}`,
          "content-type": "application/json",
        },
        payload: method === "POST" ? {} : undefined,
      });
      expect(res.statusCode, `${method} ${url} must register in test mode`).not.toBe(404);
    }
    await app.close();
  });
});
