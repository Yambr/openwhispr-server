// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 03 / Task 3 — `/api/auth/verification-status` plugin tests.
//
// In-process: hand-rolled fake `AuthLike` (cookie-only contract) + fake
// `TransactionalDb` with a `users.email_verified_at` row injection. End-
// to-end with a real backend lives in Plan 06.
//
// Coverage:
//   * cookie + verified user → {verified:true}
//   * cookie + unverified user → {verified:false}
//   * cookie + email not in DB → {verified:false}
//   * NO cookie → 401 + envelope
//   * bearer-only (no cookie) → 401 (cookie-only enforcement; bearer is
//     stripped before getSession by `requireCookieOnly`)
//   * extra query field → 400 (.strict)
//   * non-email query → 400

import { ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { _resetDefaultTenantCacheForTesting } from "../../../src/lib/default-tenant.js";
import type { AuthLike } from "../../../src/middleware/dual-auth.js";
import { zodTypeProvider } from "../../../src/plugins/zod-type-provider.js";
import { buildVerificationStatusRoutes } from "../../../src/routes/verification-status.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";

type RowFor = (sqlText: string) => Array<{ email_verified_at: string | null }>;

type FakeTx = { execute(query: unknown): Promise<unknown> };

function makeFakeDb(rowsFor: RowFor) {
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
      const text = parts.join("");
      return { rows: rowsFor(text) };
    },
  };
  return {
    async transaction<T>(cb: (tx: FakeTx) => Promise<T>): Promise<T> {
      return cb(tx);
    },
  };
}

function makeAuth(impl: AuthLike["api"]["getSession"]): AuthLike {
  return { api: { getSession: impl } };
}

function buildApp(deps: { db: ReturnType<typeof makeFakeDb>; auth: AuthLike }): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.register(zodTypeProvider);
  app.register(buildVerificationStatusRoutes(deps));
  return app;
}

describe("GET /api/auth/verification-status (cookie-only)", () => {
  beforeEach(() => {
    _resetDefaultTenantCacheForTesting();
  });

  afterEach(() => {
    /* noop */
  });

  it("returns {verified:true} when the user has a verified-at timestamp", async () => {
    const db = makeFakeDb((sql) => {
      if (/SELECT email_verified_at FROM users/.test(sql)) {
        return [{ email_verified_at: "2026-01-01T00:00:00Z" }];
      }
      return [];
    });
    const auth = makeAuth(async () => ({
      user: { id: "u-1", email: "v@b.test", tenantId: TENANT_A },
    }));
    const app = buildApp({ db, auth });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=v%40b.test",
      headers: { cookie: "openwhispr.session_token=valid" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ verified: true });
    await app.close();
  });

  it("returns {verified:false} for unverified user", async () => {
    const db = makeFakeDb((sql) => {
      if (/SELECT email_verified_at FROM users/.test(sql)) {
        return [{ email_verified_at: null }];
      }
      return [];
    });
    const auth = makeAuth(async () => ({
      user: { id: "u-1", email: "u@b.test", tenantId: TENANT_A },
    }));
    const app = buildApp({ db, auth });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=u%40b.test",
      headers: { cookie: "openwhispr.session_token=valid" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ verified: false });
    await app.close();
  });

  it("returns {verified:false} when no row matches", async () => {
    const db = makeFakeDb(() => []);
    const auth = makeAuth(async () => ({
      user: { id: "u-1", email: "x@b.test", tenantId: TENANT_A },
    }));
    const app = buildApp({ db, auth });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=missing%40b.test",
      headers: { cookie: "openwhispr.session_token=valid" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ verified: false });
    await app.close();
  });

  it("missing cookie → 401 + envelope", async () => {
    const db = makeFakeDb(() => []);
    const auth = makeAuth(async () => null);
    const app = buildApp({ db, auth });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=anyone%40b.test",
    });
    expect(res.statusCode).toBe(401);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
    await app.close();
  });

  it("bearer-only (no cookie) → 401 (cookie-only enforcement)", async () => {
    // The fake getSession will be invoked WITHOUT Authorization header
    // (requireCookieOnly strips it). With no cookie either, it returns null.
    const db = makeFakeDb(() => []);
    const auth = makeAuth(async ({ headers }) => {
      expect(headers.has("authorization")).toBe(false);
      return null;
    });
    const app = buildApp({ db, auth });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=any%40b.test",
      headers: { authorization: "Bearer would-pass-on-other-routes" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("extra query field → 400 (.strict on request)", async () => {
    const db = makeFakeDb(() => []);
    const auth = makeAuth(async () => ({
      user: { id: "u-1", email: "x@b.test", tenantId: TENANT_A },
    }));
    const app = buildApp({ db, auth });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=ok%40b.test&extra=1",
      headers: { cookie: "openwhispr.session_token=valid" },
    });
    expect(res.statusCode).toBe(400);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
    await app.close();
  });

  it("non-email query value → 400", async () => {
    const db = makeFakeDb(() => []);
    const auth = makeAuth(async () => ({
      user: { id: "u-1", email: "x@b.test", tenantId: TENANT_A },
    }));
    const app = buildApp({ db, auth });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=not-an-email",
      headers: { cookie: "openwhispr.session_token=valid" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  // Phase 56 / Plan 56-09 — R5 conformance: ?email= param is documented
  // in BACKEND_SPEC but the SERVER MUST derive identity from session, not
  // the param. Tolerate any well-formed email value (incl. mismatch with
  // the session-derived caller) without 400. Verified status reflects the
  // SESSION user, never the client-supplied param. See SERVER-REQUIREMENTS
  // §R5 (`/Users/dev/openwhispr/.planning/phases/08-client-server-audit/
  // SERVER-REQUIREMENTS.md` lines 219-254).

  it("R5: ?email= mismatching session does NOT 400 and returns session truth", async () => {
    // Session user is alice (verified). Param is bob. Server MUST return
    // 200 with alice's verified-state, NOT 400 and NOT bob's truth.
    const db = makeFakeDb((sql) => {
      if (/SELECT email_verified_at FROM users/.test(sql)) {
        return [{ email_verified_at: "2026-01-01T00:00:00Z" }];
      }
      return [];
    });
    const auth = makeAuth(async () => ({
      user: { id: "u-alice", email: "alice@b.test", tenantId: TENANT_A },
    }));
    const app = buildApp({ db, auth });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=bob%40b.test",
      headers: { cookie: "openwhispr.session_token=valid" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ verified: true });
    await app.close();
  });

  // Phase 59 / Track D — R15/R5: the `?email=` param is OPTIONAL. R5
  // requires the server to "accept the email query param without
  // warning, without error" — which includes its ABSENCE. A required-
  // param schema (400 when omitted) is the direct inverse of R5. The
  // desktop client polls this route with a session cookie and no param.
  it("R15/R5: GET without ?email= returns 200 (param is optional)", async () => {
    const db = makeFakeDb((sql) => {
      if (/SELECT email_verified_at FROM users/.test(sql)) {
        return [{ email_verified_at: "2026-01-01T00:00:00Z" }];
      }
      return [];
    });
    const auth = makeAuth(async () => ({
      user: { id: "u-1", email: "v@b.test", tenantId: TENANT_A },
    }));
    const app = buildApp({ db, auth });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status",
      headers: { cookie: "openwhispr.session_token=valid" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ verified: true });
    await app.close();
  });

  it("R5: SQL WHERE-email is bound to the SESSION email, not the client param", async () => {
    // Capture SQL parameter bindings and assert the lookup key is the
    // session-derived email. This is the LOCK-IN test that proves the
    // server ignores the client-supplied ?email= for authoritative use.
    const seenEmails: string[] = [];
    const tx: FakeTx = {
      async execute(query: unknown): Promise<unknown> {
        // Drizzle's `sql` template places bound parameter VALUES directly
        // into `queryChunks` as bare primitives, interleaved with
        // template-string objects (`{ value: string[] }`). Extract the
        // string primitives to inspect what the handler bound.
        const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
        for (const c of chunks) {
          if (typeof c === "string" && c.includes("@")) seenEmails.push(c);
        }
        return { rows: [{ email_verified_at: null }] };
      },
    };
    const db = {
      async transaction<T>(cb: (t: FakeTx) => Promise<T>): Promise<T> {
        return cb(tx);
      },
    };
    const auth = makeAuth(async () => ({
      user: { id: "u-alice", email: "alice@b.test", tenantId: TENANT_A },
    }));
    const app = buildApp({ db, auth });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=bob%40b.test",
      headers: { cookie: "openwhispr.session_token=valid" },
    });
    expect(res.statusCode).toBe(200);
    expect(seenEmails).toContain("alice@b.test");
    expect(seenEmails).not.toContain("bob@b.test");
    await app.close();
  });

  it("R5 defense-in-depth: session without email → verified=false (no DB query)", async () => {
    // If requireCookieOnly ever attaches a session whose user has no
    // email (provider quirk, future identity-provider drift, etc.), the
    // handler MUST short-circuit to verified=false rather than running
    // an unbound SQL query. Pin this branch.
    let dbQueried = false;
    const db = makeFakeDb(() => {
      dbQueried = true;
      return [];
    });
    const auth = makeAuth(async () => ({
      // Cast through `unknown` is forbidden by LOCKER-02; instead
      // construct a session whose `user.email` is empty string. Empty
      // string is falsy and triggers the defense branch identically.
      user: { id: "u-1", email: "", tenantId: TENANT_A },
    }));
    const app = buildApp({ db, auth });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=any%40b.test",
      headers: { cookie: "openwhispr.session_token=valid" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ verified: false });
    expect(dbQueried).toBe(false);
    await app.close();
  });

  it("R5: ?email= with a well-formed unknown address still returns 200 (session truth)", async () => {
    const db = makeFakeDb((sql) => {
      if (/SELECT email_verified_at FROM users/.test(sql)) {
        return [{ email_verified_at: "2026-01-01T00:00:00Z" }];
      }
      return [];
    });
    const auth = makeAuth(async () => ({
      user: { id: "u-alice", email: "alice@b.test", tenantId: TENANT_A },
    }));
    const app = buildApp({ db, auth });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=does-not-exist%40nowhere.test",
      headers: { cookie: "openwhispr.session_token=valid" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ verified: true });
    await app.close();
  });

  // Phase-2 debt back-fill — exercises the `if (!req.tenant)` defense-
  // in-depth branch at verification-status.ts:53-56. Reachable when the
  // session resolves but tenantId is the empty string (`?? fallback`
  // does not catch ""). Production should never hit this; the test pins
  // the canonical 401 envelope so the defense doesn't regress silently.
  it("session with empty tenantId hits the defense-in-depth 401 branch", async () => {
    const db = makeFakeDb(() => []);
    const auth = makeAuth(async () => ({
      // tenantId is "" — empty string survives `??` and produces
      // `req.tenant = ""`, then `if (!req.tenant)` is true → AuthError.
      user: { id: "u-1", email: "x@b.test", tenantId: "" },
    }));
    const app = buildApp({ db, auth });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=ok%40b.test",
      headers: { cookie: "openwhispr.session_token=valid" },
    });
    expect(res.statusCode).toBe(401);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
    expect(res.json().error).toBe("session expired");
    await app.close();
  });
});
