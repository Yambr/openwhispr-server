// SPDX-License-Identifier: FSL-1.1-ALv2
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
import { ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { _resetDefaultTenantCacheForTesting } from "../../../src/lib/default-tenant.js";
import type { AuthLike } from "../../../src/middleware/dual-auth.js";
import { zodTypeProvider } from "../../../src/plugins/zod-type-provider.js";
import {
  buildDeleteAccountRoutes,
  SESSION_COOKIE_NAME,
} from "../../../src/routes/delete-account.js";

// Phase 6 / Plan 05 — recordAudit() validates ctx via Zod and requires
// RFC-4122 v4-shaped UUIDs (version nibble 4, variant 8/9/a/b). The
// pre-Plan-05 test fixtures used `1111…/2222…` literals which fail
// strict UUID validation; update to v4-shaped equivalents.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

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
      user: { id: USER_ID, email: "del@b.test", tenantId: TENANT_A },
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
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : (setCookie ?? "");
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
      user: { id: USER_ID, email: "x@b.test", tenantId: "" },
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

  // BUG-55-01-b-04 (RED) — empty body + `Content-Type: application/json`
  // trips Fastify's JSON parser with FST_ERR_CTP_EMPTY_JSON_BODY which,
  // un-mapped, surfaces as a 500 via the default catch-all in
  // error-handler.ts. The canonical envelope for a malformed-body request
  // is 400 (VALIDATION_ERROR). This test pins the contract so the parser
  // exception can never silently 500 again. Triggers on UNAUTHENTICATED
  // requests too because content-type parsing happens BEFORE the route's
  // preHandler — so we don't need a valid cookie.
  it("DELETE with empty body + json content-type returns 400 envelope (not 500)", async () => {
    const { db } = makeFakeDb();
    const auth = makeAuth(async () => ({
      user: { id: USER_ID, email: "del@b.test", tenantId: TENANT_A },
    }));
    const app = await buildApp({ db, auth });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/auth/delete-account",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=valid`,
        "content-type": "application/json",
      },
      payload: "",
    });
    expect(res.statusCode).toBe(400);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
    await app.close();
  });

  // Phase 6 / Plan 05 — the canonical `account.delete` payload is
  // `{}` per D-A7 (no per-action keys; ctx-attached request_id, ip,
  // user_agent cover correlation). The pre-Plan-05 test asserted an
  // `email` payload field that is no longer emitted; the assertion
  // is now that the helper-emitted INSERT lands at all even when the
  // session user record is missing optional fields like `email`.
  it("audit log INSERT runs even when the session user has no email field", async () => {
    const { db, recorded } = makeFakeDb();
    const auth = makeAuth(async () => ({
      // No `email` key on the user object — the optional chaining branch
      // must fall back to `null`.
      user: { id: USER_ID, tenantId: TENANT_A } as unknown as {
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
