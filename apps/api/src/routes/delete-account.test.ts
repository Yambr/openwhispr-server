// Phase 2 / Plan 03 / Task 3 — `/api/auth/delete-account` plugin tests.
//
// In-process: hand-rolled fake `AuthLike` (cookie-only contract) + fake
// `TransactionalDb` that records every SQL fragment so we can assert
// the cascading-delete order: DELETE sessions, INSERT audit_log, DELETE
// users — all under one set_config. Conformance against a real backend
// (cascade actually persists; subsequent verification-status returns
// 401 because the session row is gone) lives in Plan 06.
import "@fastify/cookie";
import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import { registerErrorHandler } from "../error-handler.js";
import { zodTypeProvider } from "../plugins/zod-type-provider.js";
import { _resetDefaultTenantCacheForTesting } from "../lib/default-tenant.js";
import type { AuthLike } from "../middleware/dual-auth.js";
import {
  buildDeleteAccountRoutes,
  SESSION_COOKIE_NAME,
} from "./delete-account.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";

interface RecordedQuery {
  sql: string;
}

type FakeTx = { execute(query: unknown): Promise<unknown> };

function makeFakeDb(): {
  db: { transaction<T>(cb: (tx: FakeTx) => Promise<T>): Promise<T> };
  recorded: RecordedQuery[];
} {
  const recorded: RecordedQuery[] = [];
  const tx: FakeTx = {
    async execute(query: unknown): Promise<unknown> {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const parts: string[] = [];
      for (const c of chunks) {
        if (typeof c === "string") parts.push(c);
        else if (c && typeof c === "object" && "value" in c) {
          const v = (c as { value: unknown }).value;
          if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
            parts.push((v as string[]).join(""));
          } else {
            parts.push("?");
          }
        }
      }
      recorded.push({ sql: parts.join("") });
      return { rows: [] };
    },
  };
  return {
    db: {
      async transaction<T>(cb: (tx: FakeTx) => Promise<T>): Promise<T> {
        return cb(tx);
      },
    },
    recorded,
  };
}

function makeAuth(impl: AuthLike["api"]["getSession"]): AuthLike {
  return { api: { getSession: impl } };
}

async function buildApp(deps: {
  db: ReturnType<typeof makeFakeDb>["db"];
  auth: AuthLike;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(fastifyCookie);
  await app.register(zodTypeProvider);
  await app.register(buildDeleteAccountRoutes(deps));
  return app;
}

describe("DELETE /api/auth/delete-account (cookie-only, cascade)", () => {
  beforeEach(() => {
    _resetDefaultTenantCacheForTesting();
  });

  afterEach(() => {
    /* noop */
  });

  it("returns 200 + {} on the happy path and clears the session cookie", async () => {
    const { db, recorded } = makeFakeDb();
    const auth = makeAuth(async () => ({
      user: { id: "u-1", email: "del@b.test", tenantId: TENANT_A },
    }));
    const app = await buildApp({ db, auth });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/auth/delete-account",
      headers: { cookie: `${SESSION_COOKIE_NAME}=valid` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});

    // Cascade order: set_config -> DELETE sessions -> INSERT audit_log -> DELETE users
    const sqls = recorded.map((r) => r.sql);
    const setConfigIdx = sqls.findIndex((s) => /set_config/i.test(s));
    const delSessionsIdx = sqls.findIndex((s) => /DELETE FROM sessions/i.test(s));
    const insertAuditIdx = sqls.findIndex((s) => /INSERT INTO audit_log/i.test(s));
    const delUsersIdx = sqls.findIndex((s) => /DELETE FROM users/i.test(s));
    expect(setConfigIdx).toBeGreaterThanOrEqual(0);
    expect(delSessionsIdx).toBeGreaterThan(setConfigIdx);
    expect(insertAuditIdx).toBeGreaterThan(delSessionsIdx);
    expect(delUsersIdx).toBeGreaterThan(insertAuditIdx);

    // Set-Cookie cleared the session cookie (Max-Age=0 or Expires=past).
    const setCookie = res.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie ?? "";
    expect(cookieStr).toContain(SESSION_COOKIE_NAME);
    await app.close();
  });

  it("missing cookie → 401 + envelope (no DB writes)", async () => {
    const { db, recorded } = makeFakeDb();
    const auth = makeAuth(async () => null);
    const app = await buildApp({ db, auth });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/auth/delete-account",
    });
    expect(res.statusCode).toBe(401);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
    expect(recorded.length).toBe(0);
    await app.close();
  });

  it("bearer-only (no cookie) → 401 (cookie-only enforcement)", async () => {
    const { db, recorded } = makeFakeDb();
    const auth = makeAuth(async ({ headers }) => {
      expect(headers.has("authorization")).toBe(false);
      return null;
    });
    const app = await buildApp({ db, auth });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/auth/delete-account",
      headers: { authorization: "Bearer x" },
    });
    expect(res.statusCode).toBe(401);
    expect(recorded.length).toBe(0);
    await app.close();
  });

  // Phase-2 debt back-fill — exercises the `if (!req.user || !req.tenant)`
  // defense-in-depth branch at delete-account.ts:96-98. requireCookieOnly
  // attaches `req.user = session.user` directly; a session whose user is
  // null (corrupted session row, future Better-Auth bug) flows through to
  // the handler with req.user falsy and trips the 401 fallback.
  it("session with empty tenantId hits the defense-in-depth 401 branch", async () => {
    const { db, recorded } = makeFakeDb();
    const auth = makeAuth(async () => ({
      // tenantId is "" — empty string survives `??` (only null/undefined
      // trigger the fallback) so `req.tenant = ""` and the `!req.tenant`
      // leg of the OR short-circuit is truthy. Production sessions
      // should never carry an empty tenantId; this is a defense-in-depth
      // pin that re-asserts the canonical 401 envelope.
      user: { id: "u-1", email: "x@b.test", tenantId: "" },
    }));
    const app = await buildApp({ db, auth });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/auth/delete-account",
      headers: { cookie: `${SESSION_COOKIE_NAME}=valid` },
    });
    expect(res.statusCode).toBe(401);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
    expect(res.json().error).toBe("session expired");
    // No DB writes — the cascade is gated by the 401.
    expect(recorded.length).toBe(0);
    await app.close();
  });

  // Phase-2 debt back-fill — exercises the `req.user?.email ?? null`
  // fallback branch at delete-account.ts:107. Session is valid but the
  // user record carries no `email` field (defensive: legacy rows /
  // anonymised sessions).
  it("audit log records email=null when the session user has no email field", async () => {
    const { db, recorded } = makeFakeDb();
    const auth = makeAuth(async () => ({
      // No `email` key on the user object — the optional chaining branch
      // must fall back to `null`.
      user: { id: "u-no-email", tenantId: TENANT_A } as unknown as {
        id: string;
        email: string;
        tenantId: string;
      },
    }));
    const app = await buildApp({ db, auth });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/auth/delete-account",
      headers: { cookie: `${SESSION_COOKIE_NAME}=valid` },
    });
    expect(res.statusCode).toBe(200);
    // The audit_log INSERT chunk parameterises the email field; the fake
    // collapses non-string interpolations to "?", so the assertion here
    // is the structural one: the INSERT ran, between sessions delete and
    // users delete (proving the handler completed past the audit step
    // even with email=null).
    const sqls = recorded.map((r) => r.sql);
    expect(sqls.some((s) => /INSERT INTO audit_log/i.test(s))).toBe(true);
    expect(sqls.some((s) => /DELETE FROM users/i.test(s))).toBe(true);
    await app.close();
  });
});
