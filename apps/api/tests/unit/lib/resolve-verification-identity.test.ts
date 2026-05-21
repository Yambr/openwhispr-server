// SPDX-License-Identifier: FSL-1.1-ALv2
// R21 — `buildResolveVerificationIdentity` unit coverage.
//
// The helper resolves the (email, tenant) pair the verification-status
// route looks up. Two deterministic paths:
//   1. cookie session present → identity session-derived; `?email=` is
//      IGNORED even on mismatch (cookie wins; no silent mixing).
//   2. no session → identity email-derived from validated `req.query.email`;
//      tenant = default tenant. Absent `?email=` → email undefined.
//
// The Better Auth `getSession` is a process boundary — stubbed here. The
// helper itself is exercised for real (NOT mocked).

import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { _resetDefaultTenantCacheForTesting } from "../../../src/lib/default-tenant.js";
import { buildResolveVerificationIdentity } from "../../../src/lib/resolve-verification-identity.js";
import type { AuthLike } from "../../../src/middleware/dual-auth.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const DEFAULT_TENANT = "00000000-0000-0000-0000-000000000000";

function makeAuth(impl: AuthLike["api"]["getSession"]): AuthLike {
  return { api: { getSession: impl } };
}

/**
 * Minimal FastifyRequest stand-in carrying just the surface the helper
 * reads: `headers` and `query`. Constructed structurally (no cast
 * through `unknown` — LOCKER-02) by spreading onto a partial.
 */
function fakeReq(opts: {
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
}): FastifyRequest {
  const req = {
    headers: opts.headers ?? {},
    query: opts.query ?? {},
  };
  return req as Pick<FastifyRequest, "headers" | "query"> as FastifyRequest;
}

describe("buildResolveVerificationIdentity", () => {
  it("cookie session present → identity is session-derived", async () => {
    const auth = makeAuth(async () => ({
      user: { id: "u-1", email: "alice@b.test", tenantId: TENANT_A },
    }));
    const resolve = buildResolveVerificationIdentity({ auth });
    const out = await resolve(fakeReq({ headers: { cookie: "openwhispr.session_token=valid" } }));
    expect(out).toEqual({ email: "alice@b.test", tenant: TENANT_A });
  });

  it("cookie wins over a mismatching ?email= (no silent mixing)", async () => {
    const auth = makeAuth(async () => ({
      user: { id: "u-1", email: "alice@b.test", tenantId: TENANT_A },
    }));
    const resolve = buildResolveVerificationIdentity({ auth });
    const out = await resolve(
      fakeReq({
        headers: { cookie: "openwhispr.session_token=valid" },
        query: { email: "bob@b.test" },
      }),
    );
    expect(out).toEqual({ email: "alice@b.test", tenant: TENANT_A });
  });

  it("cookie session with no tenantId → falls back to default tenant", async () => {
    _resetDefaultTenantCacheForTesting();
    const auth = makeAuth(async () => ({
      user: { id: "u-1", email: "alice@b.test" },
    }));
    const resolve = buildResolveVerificationIdentity({ auth });
    const out = await resolve(fakeReq({ headers: { cookie: "openwhispr.session_token=valid" } }));
    expect(out).toEqual({ email: "alice@b.test", tenant: DEFAULT_TENANT });
  });

  it("strips Authorization before calling getSession (cookie-only path)", async () => {
    let sawAuth = true;
    const auth = makeAuth(async ({ headers }) => {
      sawAuth = headers.has("authorization");
      return null;
    });
    const resolve = buildResolveVerificationIdentity({ auth });
    await resolve(
      fakeReq({
        headers: { authorization: "Bearer would-pass-on-other-routes" },
        query: { email: "bob@b.test" },
      }),
    );
    expect(sawAuth).toBe(false);
  });

  it("no session + format-valid ?email= → identity is email-derived", async () => {
    _resetDefaultTenantCacheForTesting();
    const auth = makeAuth(async () => null);
    const resolve = buildResolveVerificationIdentity({ auth });
    const out = await resolve(fakeReq({ query: { email: "bob@b.test" } }));
    expect(out).toEqual({ email: "bob@b.test", tenant: DEFAULT_TENANT });
  });

  it("no session + no ?email= → email is undefined, tenant is default", async () => {
    _resetDefaultTenantCacheForTesting();
    const auth = makeAuth(async () => null);
    const resolve = buildResolveVerificationIdentity({ auth });
    const out = await resolve(fakeReq({ query: {} }));
    expect(out).toEqual({ email: undefined, tenant: DEFAULT_TENANT });
  });

  it("no session + non-string ?email= → email is undefined", async () => {
    _resetDefaultTenantCacheForTesting();
    const auth = makeAuth(async () => null);
    const resolve = buildResolveVerificationIdentity({ auth });
    const out = await resolve(fakeReq({ query: { email: 12345 } }));
    expect(out).toEqual({ email: undefined, tenant: DEFAULT_TENANT });
  });
});
