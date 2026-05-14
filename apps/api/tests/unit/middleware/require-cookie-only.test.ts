// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 03 / Task 2 — `requireCookieOnly` unit tests.
//
// BACKEND_SPEC.md mandates that `/api/auth/verification-status` and
// `/api/auth/delete-account` accept ONLY the session cookie — never a
// bearer token. The hook strips `Authorization` from the headers handed
// to Better Auth so a stray bearer cannot fall through.
//
// Strategy mirrors `dual-auth.test.ts`: hand-rolled fake `AuthLike`,
// in-process Fastify, exercise via `app.inject()`. End-to-end with a
// real Better Auth instance lives in Plan 06.
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { _resetDefaultTenantCacheForTesting } from "../../../src/lib/default-tenant.js";
import type { AuthLike } from "../../../src/middleware/dual-auth.js";
import {
  buildRequireCookieOnly,
  cookieOnlyHeaders,
} from "../../../src/middleware/require-cookie-only.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const DEFAULT_TENANT = "00000000-0000-0000-0000-000000000000";

function makeAuth(impl: AuthLike["api"]["getSession"]): AuthLike {
  return { api: { getSession: impl } };
}

function buildApp(auth: AuthLike): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.addHook("preHandler", buildRequireCookieOnly({ auth }));
  app.get("/__cookie", async (req) => ({
    user: req.user ?? null,
    tenant: req.tenant ?? null,
  }));
  return app;
}

describe("requireCookieOnly — bearer is silently dropped before getSession", () => {
  beforeEach(() => {
    _resetDefaultTenantCacheForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("bearer-only request → 401 (no cookie, bearer ignored)", async () => {
    const auth = makeAuth(async ({ headers }) => {
      // Authorization MUST have been stripped before reaching getSession.
      expect(headers.has("authorization")).toBe(false);
      return null;
    });
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/__cookie",
      headers: { authorization: "Bearer would-have-worked-on-dual-auth" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
    await app.close();
  });

  it("cookie-only request with valid session → 200 + user/tenant set", async () => {
    const auth = makeAuth(async () => ({
      user: { id: "u-1", email: "a@b.test", tenantId: TENANT_A },
    }));
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/__cookie",
      headers: { cookie: "openwhispr.session_token=valid" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      user: { id: "u-1", email: "a@b.test", tenantId: TENANT_A },
      tenant: TENANT_A,
    });
    await app.close();
  });

  it("bearer + cookie: cookie wins, bearer ignored (Authorization stripped)", async () => {
    const observed: { value: Headers | null } = { value: null };
    const auth = makeAuth(async ({ headers }) => {
      observed.value = headers;
      return { user: { id: "u-1", email: "a@b.test", tenantId: TENANT_A } };
    });
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/__cookie",
      headers: {
        authorization: "Bearer should-be-dropped",
        cookie: "openwhispr.session_token=valid",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(observed.value).not.toBeNull();
    expect(observed.value?.has("authorization")).toBe(false);
    expect(observed.value?.get("cookie")).toBe("openwhispr.session_token=valid");
    await app.close();
  });

  it("falls back to default tenant when session.user.tenantId is missing", async () => {
    const auth = makeAuth(async () => ({
      user: { id: "u-1", email: "a@b.test" },
    }));
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/__cookie",
      headers: { cookie: "openwhispr.session_token=valid" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tenant).toBe(DEFAULT_TENANT);
    await app.close();
  });

  it("missing cookie AND missing bearer → 401", async () => {
    const auth = makeAuth(async () => null);
    const app = buildApp(auth);
    const res = await app.inject({ method: "GET", url: "/__cookie" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("cookieOnlyHeaders helper", () => {
  it("strips Authorization (case-insensitive) but preserves other headers", () => {
    const headers = cookieOnlyHeaders({
      Authorization: "Bearer drop",
      cookie: "k=v",
      host: "api.localhost",
      "x-openwhispr-source": "desktop",
    });
    expect(headers.has("authorization")).toBe(false);
    expect(headers.get("cookie")).toBe("k=v");
    expect(headers.get("host")).toBe("api.localhost");
    expect(headers.get("x-openwhispr-source")).toBe("desktop");
  });

  it("comma-joins array-valued headers (Web platform multi-value)", () => {
    const headers = cookieOnlyHeaders({ "set-cookie": ["a=1", "b=2"] });
    expect(headers.get("set-cookie")).toBe("a=1, b=2");
  });
});
