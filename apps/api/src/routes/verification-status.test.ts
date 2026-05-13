// SPDX-License-Identifier: Apache-2.0
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
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import { registerErrorHandler } from "../error-handler.js";
import { zodTypeProvider } from "../plugins/zod-type-provider.js";
import { _resetDefaultTenantCacheForTesting } from "../lib/default-tenant.js";
import type { AuthLike } from "../middleware/dual-auth.js";
import { buildVerificationStatusRoutes } from "./verification-status.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";

interface RowFor {
  (sqlText: string): Array<{ email_verified_at: string | null }>;
}

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

function buildApp(deps: {
  db: ReturnType<typeof makeFakeDb>;
  auth: AuthLike;
}): FastifyInstance {
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
