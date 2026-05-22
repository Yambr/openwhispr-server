// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 03 / Task 2 — `dualAuthHook` unit tests.
//
// Strategy: exercise the hook against a hand-rolled `AuthLike` fake.
// The fake mirrors Better Auth's `auth.api.getSession({headers})`
// surface — the only one the hook touches. End-to-end conformance
// against a REAL Better Auth instance lives in Plan 06's CONTRACT-01
// (which runs against a deployed backend with seeded fixtures); the
// in-process unit tests pin the BRANCHING of the hook itself: opt-out,
// session-found, session-missing-with-bearer (overlap fallback),
// session-missing-without-bearer, route-config integration, header
// pass-through, multi-value Authorization header.
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { _resetDefaultTenantCacheForTesting } from "../../../src/lib/default-tenant.js";
import {
  __test,
  type AuthLike,
  buildDualAuthHook,
  type SessionResult,
  type TryPreviousToken,
} from "../../../src/middleware/dual-auth.js";

const DEFAULT_TENANT = "00000000-0000-0000-0000-000000000000";
const TENANT_A = "11111111-1111-1111-1111-111111111111";

function makeAuth(impl: AuthLike["api"]["getSession"]): AuthLike {
  return { api: { getSession: impl } };
}

function buildAppWithHook(opts: {
  auth: AuthLike;
  tryPreviousToken?: TryPreviousToken;
}): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  const baseHook = buildDualAuthHook({ auth: opts.auth });
  const overlapHook = opts.tryPreviousToken
    ? buildDualAuthHook({
        auth: opts.auth,
        tryPreviousToken: opts.tryPreviousToken,
      })
    : null;
  app.addHook("preHandler", overlapHook ?? baseHook);

  // Auth-required echo route.
  app.get("/__authed", async (req) => ({
    user: req.user ?? null,
    tenant: req.tenant ?? null,
  }));

  // Opt-out route.
  app.get("/__skip", { config: { auth: false } }, async (req) => ({
    user: req.user ?? null,
    tenant: req.tenant ?? null,
  }));
  return app;
}

describe("dualAuthHook — branching matrix", () => {
  beforeEach(() => {
    _resetDefaultTenantCacheForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opts out when route config sets auth=false", async () => {
    const auth = makeAuth(async () => null); // would 401 if called
    const spy = vi.spyOn(auth.api, "getSession");
    const app = buildAppWithHook({ auth });
    const res = await app.inject({ method: "GET", url: "/__skip" });
    expect(res.statusCode).toBe(200);
    expect(spy).not.toHaveBeenCalled();
    expect(res.json()).toEqual({ user: null, tenant: null });
    await app.close();
  });

  it("attaches user + tenant when getSession returns a session (bearer or cookie path)", async () => {
    const session: SessionResult = {
      user: { id: "u-1", email: "a@b.test", tenantId: TENANT_A },
    };
    const auth = makeAuth(async () => session);
    const app = buildAppWithHook({ auth });
    const res = await app.inject({
      method: "GET",
      url: "/__authed",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: session.user, tenant: TENANT_A });
    await app.close();
  });

  it("falls back to default tenant when session.user.tenantId is null/undefined", async () => {
    const auth = makeAuth(async () => ({
      user: { id: "u-1", email: "a@b.test", tenantId: null },
    }));
    const app = buildAppWithHook({ auth });
    const res = await app.inject({
      method: "GET",
      url: "/__authed",
      headers: { cookie: "openwhispr.session_token=cookie-value" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tenant).toBe(DEFAULT_TENANT);
    await app.close();
  });

  it("emits 401 + envelope when both bearer and cookie fail and there is no overlap fallback", async () => {
    const auth = makeAuth(async () => null);
    const app = buildAppWithHook({ auth });
    const res = await app.inject({
      method: "GET",
      url: "/__authed",
      headers: { authorization: "Bearer bogus" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    await app.close();
  });

  it("emits 401 with NO Authorization and NO Cookie (PITFALLS #1: never 200)", async () => {
    const auth = makeAuth(async () => null);
    const app = buildAppWithHook({ auth });
    const res = await app.inject({ method: "GET", url: "/__authed" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
    await app.close();
  });

  it("AUTH-04 overlap: session=null but tryPreviousToken matches → user+tenant attached", async () => {
    const auth = makeAuth(async () => null);
    const overlapUser = { id: "u-2", email: "rotated@b.test" };
    const tryPreviousToken: TryPreviousToken = vi.fn(async (token: string) => {
      expect(token).toBe("rotated-token");
      return { user: overlapUser, tenantId: TENANT_A };
    });
    const app = buildAppWithHook({ auth, tryPreviousToken });
    const res = await app.inject({
      method: "GET",
      url: "/__authed",
      headers: { authorization: "Bearer rotated-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: overlapUser, tenant: TENANT_A });
    expect(tryPreviousToken).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("AUTH-04 overlap: session=null AND overlap miss → 401", async () => {
    const auth = makeAuth(async () => null);
    const tryPreviousToken: TryPreviousToken = async () => null;
    const app = buildAppWithHook({ auth, tryPreviousToken });
    const res = await app.inject({
      method: "GET",
      url: "/__authed",
      headers: { authorization: "Bearer rotated-but-expired" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
    await app.close();
  });

  it("AUTH-04 overlap: missing bearer header skips overlap path entirely", async () => {
    const auth = makeAuth(async () => null);
    const overlapSpy = vi.fn<TryPreviousToken>(async () => null);
    const app = buildAppWithHook({ auth, tryPreviousToken: overlapSpy });
    const res = await app.inject({
      method: "GET",
      url: "/__authed",
      headers: { cookie: "openwhispr.session_token=expired" },
    });
    expect(res.statusCode).toBe(401);
    expect(overlapSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("forwards request headers to getSession including cookies", async () => {
    const observed: { value: Headers | null } = { value: null };
    const auth = makeAuth(async ({ headers }) => {
      observed.value = headers;
      return null;
    });
    const app = buildAppWithHook({ auth });
    await app.inject({
      method: "GET",
      url: "/__authed",
      headers: {
        authorization: "Bearer x",
        cookie: "openwhispr.session_token=abc; other=def",
        "x-openwhispr-source": "desktop",
      },
    });
    expect(observed.value).not.toBeNull();
    expect(observed.value?.get("authorization")).toBe("Bearer x");
    expect(observed.value?.get("cookie")).toBe("openwhispr.session_token=abc; other=def");
    expect(observed.value?.get("x-openwhispr-source")).toBe("desktop");
    await app.close();
  });

  it("malformed Authorization header (not 'Bearer X') still triggers 401 and does NOT call overlap", async () => {
    const auth = makeAuth(async () => null);
    const overlapSpy = vi.fn<TryPreviousToken>(async () => null);
    const app = buildAppWithHook({ auth, tryPreviousToken: overlapSpy });
    const res = await app.inject({
      method: "GET",
      url: "/__authed",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.statusCode).toBe(401);
    expect(overlapSpy).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("dual-auth helpers", () => {
  it("fastifyHeadersToWebHeaders: comma-joins array values (Web platform multi-value)", () => {
    const headers = __test.fastifyHeadersToWebHeaders({
      "x-multi": ["a", "b"],
      "x-single": "v",
      "x-undef": undefined,
    });
    expect(headers.get("x-multi")).toBe("a, b");
    expect(headers.get("x-single")).toBe("v");
    expect(headers.has("x-undef")).toBe(false);
  });

  it("extractBearer: returns null for missing/non-Bearer headers and the token otherwise", () => {
    expect(__test.extractBearer(undefined)).toBeNull();
    expect(__test.extractBearer("Basic abc")).toBeNull();
    expect(__test.extractBearer("Bearer  spaced-token  ")).toBe("spaced-token");
    expect(__test.extractBearer("bearer caseInsensitive")).toBe("caseInsensitive");
    expect(__test.extractBearer(["Bearer first", "Bearer second"])).toBe("first");
  });

  // v2.5-B / CodeQL #14 (js/polynomial-redos) — the linear-time rewrite
  // of extractBearer must match the SAME strings as the prior
  // `/^Bearer\s+(.+)$/i`, and must NOT exhibit super-linear backtracking.
  it("extractBearer: linear rewrite preserves the no-whitespace and tab cases", () => {
    // `Bearerx` — no whitespace after the prefix → no match (null).
    expect(__test.extractBearer("Bearerx")).toBeNull();
    // bare `Bearer` with no separator → null.
    expect(__test.extractBearer("Bearer")).toBeNull();
    // tab separator is whitespace → token extracted.
    expect(__test.extractBearer("Bearer\ttok")).toBe("tok");
    // whitespace-only suffix trims to empty string (prior behaviour).
    expect(__test.extractBearer("Bearer   ")).toBe("");
  });

  it("extractBearer: pathological all-whitespace input resolves in linear time", () => {
    // The prior regex was quadratic on `Bearer ` + many spaces with no
    // non-space terminator. A 100k-space payload must complete fast.
    const pathological = `Bearer ${" ".repeat(100_000)}`;
    const start = performance.now();
    expect(__test.extractBearer(pathological)).toBe("");
    expect(performance.now() - start).toBeLessThan(100);
  });
});
