// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 35 / 35.a — CR-2 (CRIT-FIX-04) integration regression.
//
// The three "public" bootstrap routes (`/api/locale`, `/api/auth/providers`,
// `/api/setup-state`) advertise themselves as unauthenticated in their
// doc comments, but `auth-providers.ts` + `setup-state.ts` historically
// omitted `config.auth = false`. The global `dualAuthHook` in
// `buildApp()` (apps/api/src/index.ts:428 `addHook("onRequest", ...)`)
// short-circuits with 401 unless a route opts out — making the wizard's
// pre-admin RSC fetch fail in production.
//
// The pre-existing per-route unit tests register routes on a bare
// Fastify instance with no dualAuthHook installed, so they false-pass.
// This integration test boots the FULL buildApp() stack with a fake
// Better-Auth instance that resolves no session, then asserts each of
// the three routes returns 200 to anonymous traffic. RED on main pre-fix
// (locale was already fixed in 19b/SR-19b.3; auth-providers + setup-state
// would 401). GREEN after Phase 35 adds `auth: false` to both.

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../../src/index.js";

interface FakeAuthOpts {
  user?: { id: string; email: string; tenantId?: string | null } | null;
}

function makeAnonAuth(opts: FakeAuthOpts = {}) {
  return {
    handler: vi.fn(async () => new Response(null, { status: 404 })),
    api: {
      getSession: vi.fn(async () =>
        opts.user ? { user: opts.user, session: { id: "fixture-session" } } : null,
      ),
    },
  };
}

/**
 * Drizzle-compatible fake db handle. Surface matches the structural
 * `TransactionalDb<ExecutableTx>` that setup-state.ts consumes:
 *   * `transaction(cb)` exposes a `tx.execute(sql)` callable.
 *   * `execute(sql)` directly delegates to the same tx fn.
 *
 * For setup-state's `SELECT status FROM setup_state` we return an empty
 * row set — the handler falls through to its defensive default
 * (`status: 'pending'`). For any other query we likewise return empty
 * rows; no integration test in this file mutates state.
 */
function makeFakeDb() {
  const tx = {
    async execute(query: unknown): Promise<unknown> {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const sqlText = chunks
        .map((c) =>
          typeof c === "string"
            ? c
            : c && typeof c === "object" && "value" in c
              ? Array.isArray((c as { value: unknown }).value)
                ? (c as { value: string[] }).value.join("")
                : ""
              : "",
        )
        .join("");
      // Default defensive: empty rows. setup-state's handler interprets
      // a missing singleton as `status: 'pending'`.
      void sqlText;
      return { rows: [] };
    },
  };
  return {
    async transaction<T>(cb: (t: typeof tx) => Promise<T>): Promise<T> {
      return cb(tx);
    },
    async execute(query: unknown): Promise<unknown> {
      return tx.execute(query);
    },
  };
}

describe("Phase 35 / 35.a — public bootstrap endpoints bypass dualAuthHook", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("GET /api/locale returns 200 without auth", async () => {
    const auth = makeAnonAuth({ user: null });
    const db = makeFakeDb();
    app = await buildApp({ db: db as never, auth: auth as never });
    const res = await app.inject({ method: "GET", url: "/api/locale" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { locale: string };
    expect(body.locale).toBe("en");
  });

  it("GET /api/auth/providers returns 200 without auth (CR-2 fix)", async () => {
    const auth = makeAnonAuth({ user: null });
    const db = makeFakeDb();
    app = await buildApp({ db: db as never, auth: auth as never });
    const res = await app.inject({ method: "GET", url: "/api/auth/providers" });
    // Pre-fix: 401 from dualAuthHook. Post-fix: 200 from the route.
    expect(res.statusCode).toBe(200);
    const body = res.json() as { providers: unknown[]; emailVerification: unknown };
    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.emailVerification).toBeDefined();
  });

  it("GET /api/setup-state returns 200 without auth (CR-2 fix)", async () => {
    const auth = makeAnonAuth({ user: null });
    const db = makeFakeDb();
    app = await buildApp({ db: db as never, auth: auth as never });
    const res = await app.inject({ method: "GET", url: "/api/setup-state" });
    // Pre-fix: 401 from dualAuthHook. Post-fix: 200 with defensive
    // `status: 'pending'` (fake db returns no rows from setup_state).
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string };
    expect(body.status).toBe("pending");
  });

  it("regression: ALL three endpoints must NOT auth-gate anonymous traffic", async () => {
    // Sanity composite: a single buildApp boot covers all three URLs.
    // Catches any future revert that drops `auth: false` from any one
    // route without dropping it from the others.
    const auth = makeAnonAuth({ user: null });
    const db = makeFakeDb();
    app = await buildApp({ db: db as never, auth: auth as never });
    for (const url of ["/api/locale", "/api/auth/providers", "/api/setup-state"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, `${url} must not return 401`).not.toBe(401);
      expect(res.statusCode, `${url} must succeed`).toBe(
        url === "/api/auth/providers" || url === "/api/setup-state" || url === "/api/locale"
          ? 200
          : 200,
      );
    }
  });
});
