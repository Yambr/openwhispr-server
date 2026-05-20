// SPDX-License-Identifier: FSL-1.1-ALv2
// R13 — /api/_test/seed-tenant must be reachable WITHOUT a bearer.
//
// Spec: /Users/nick/openwhispr/.planning/phases/08-client-server-audit/
//   SERVER-REQUIREMENTS.md §R13 (R1 regression).
//
// The existing test-only-seed-tenant.test.ts stub skips dual-auth for
// seed-tenant by URL match (buildLocalApp: `if (req.url === ".../seed-tenant") return`).
// The DEPLOYED binary instead uses the real `dualAuthHook`, which only
// skips a route when `routeOptions.config.auth === false`. The shipped
// seed-tenant route declares `config: { rateLimit: false }` — no
// `auth: false` — so the real hook fires and 401s every request.
//
// This test wires the REAL `buildDualAuthHook` in front of the real
// test-only route surface, exactly as `apps/api/src/index.ts` does, and
// asserts seed-tenant is reachable without a bearer (200), while a route
// that legitimately requires auth (health-authed) still 401s without one.

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { buildDualAuthHook } from "../../../src/middleware/dual-auth.js";
import { buildTestOnlyRoutes, type TestOnlyDeps } from "../../../src/routes/test-only.js";

const FAKE_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function makeRecordingDb() {
  const users = new Map<string, { id: string; email: string; emailVerified: boolean }>();
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
      if (/UPDATE\s+users\s+SET[\s\S]*email_verified\s*=\s*true/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      if (/INSERT\s+INTO\s+sessions/i.test(text)) {
        return { rows: [], rowCount: 1 };
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
    users,
  };
}

function makeFakeAuth(users: ReturnType<typeof makeRecordingDb>["users"]) {
  const signUpEmail = vi.fn(async (call: { body: { email: string } }) => {
    const id = FAKE_USER_ID;
    users.set(id, { id, email: call.body.email, emailVerified: false });
    return { data: { user: { id, email: call.body.email } }, error: null };
  });
  return {
    handler: vi.fn(),
    // The real dual-auth hook calls auth.api.getSession — no bearer →
    // null session → AuthError(401) UNLESS the route opts out.
    api: { getSession: vi.fn(async () => null), signUpEmail },
  };
}

function buildAppWithRealDualAuth(): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  const { db, users } = makeRecordingDb();
  const fakeAuth = makeFakeAuth(users);
  // Mirror apps/api/src/index.ts step 8: real dual-auth hook BEFORE routes.
  app.addHook("onRequest", buildDualAuthHook({ auth: fakeAuth as never }));
  const deps: TestOnlyDeps = {
    auth: fakeAuth as unknown as TestOnlyDeps["auth"],
    db: db as unknown as TestOnlyDeps["db"],
    signUpEmail: fakeAuth.api.signUpEmail as unknown as TestOnlyDeps["signUpEmail"],
  };
  app.register(buildTestOnlyRoutes(deps));
  return app;
}

describe("R13 — seed-tenant reachable past the real dual-auth hook", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPENWHISPR_TEST_ROUTES", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("POST /api/_test/seed-tenant returns 200 with NO bearer (real dualAuthHook in front)", async () => {
    const app = buildAppWithRealDualAuth();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/_test/seed-tenant",
      headers: { "content-type": "application/json" },
      payload: {
        email: "r13@test.local",
        password: "hunter22hunter22",
        name: "r13",
        verified: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; user: { id: string; emailVerified: boolean } };
    expect(typeof body.token).toBe("string");
    expect(body.user.emailVerified).toBe(true);
    await app.close();
  });

  it("regression guard: health-authed still 401s without a bearer (auth NOT globally off)", async () => {
    const app = buildAppWithRealDualAuth();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/_test/health-authed" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
