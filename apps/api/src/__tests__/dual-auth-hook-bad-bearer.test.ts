// Phase 02.7 / Plan 03 / Task 2 — D-02 Layer 1 (RED → GREEN).
//
// Source-of-record commit: <filled at commit time>
// Reverts: removing the try/catch wrapper around `auth.api.getSession`
//   in apps/api/src/middleware/dual-auth.ts → tests 1-3 RED (the raw
//   APIError propagates past the hook, hits setErrorHandler's default
//   500 branch instead of being normalized to AuthError → 401).
//   Removing the 5xx re-throw → tests 4-5 RED (infra errors get silently
//   downgraded to 401, masking real outages).
//
// Background: Better Auth's bearer plugin THROWS APIError on malformed
// tokens (and sometimes on auth failures) rather than returning null
// from getSession. The dual-auth hook must:
//   - On 4xx APIError (UNAUTHORIZED/FORBIDDEN/BAD_REQUEST) → swallow,
//     fall through to the existing AuthError("unauthorized") emission.
//   - On 5xx APIError or non-APIError throws → re-throw so the
//     centralized error handler maps to 500/503 (preserve infra-error
//     semantics; never silently 401 a database outage).
//
// A1 finding (2026-05-09): Better Auth v1.6.9 APIError exposes
//   .status as STRING-NAME ("UNAUTHORIZED") and .statusCode as NUMBER
//   (401). The helper resolveApiErrorStatus handles BOTH defensively.

import { APIError } from "better-auth/api";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../error-handler.js";
import { _resetDefaultTenantCacheForTesting } from "../lib/default-tenant.js";
import { type AuthLike, buildDualAuthHook } from "../middleware/dual-auth.js";

function makeAuth(impl: AuthLike["api"]["getSession"]): AuthLike {
  return { api: { getSession: impl } };
}

function buildApp(auth: AuthLike): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.addHook("preHandler", buildDualAuthHook({ auth }));
  app.get("/__authed", async (req) => ({ user: req.user ?? null }));
  return app;
}

describe("dualAuthHook — bad-bearer APIError handling (D-02 Layer 1)", () => {
  beforeEach(() => {
    _resetDefaultTenantCacheForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test 1: getSession throws APIError(UNAUTHORIZED) → 401 + canonical envelope (NOT 500)", async () => {
    const auth = makeAuth(async () => {
      throw APIError.fromStatus("UNAUTHORIZED", { message: "invalid token" });
    });
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/__authed",
      headers: { authorization: "Bearer malformed" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    await app.close();
  });

  it("Test 2: getSession throws APIError(FORBIDDEN) → 401 fall-through (4xx swallow)", async () => {
    const auth = makeAuth(async () => {
      throw APIError.fromStatus("FORBIDDEN", { message: "x" });
    });
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/__authed",
      headers: { authorization: "Bearer x" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
    await app.close();
  });

  it("Test 3: getSession throws APIError(BAD_REQUEST) → 401 fall-through (4xx swallow)", async () => {
    const auth = makeAuth(async () => {
      throw APIError.fromStatus("BAD_REQUEST", { message: "x" });
    });
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/__authed",
      headers: { authorization: "Bearer x" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
    await app.close();
  });

  it("Test 4: getSession throws APIError(INTERNAL_SERVER_ERROR) → re-thrown (5xx preserved, NOT 401)", async () => {
    const auth = makeAuth(async () => {
      throw APIError.fromStatus("INTERNAL_SERVER_ERROR", { message: "db down" });
    });
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/__authed",
      headers: { authorization: "Bearer x" },
    });
    // Per D-02: 5xx APIErrors must NOT be silently downgraded to 401.
    // The error-handler's APIError branch (Layer 2) maps it to 500 with
    // canonical envelope — never leaks "db down".
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Internal server error" });
    await app.close();
  });

  it("Test 5: getSession throws plain Error (non-APIError) → re-thrown to default 500 branch", async () => {
    const auth = makeAuth(async () => {
      throw new Error("infra fail");
    });
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/__authed",
      headers: { authorization: "Bearer x" },
    });
    expect(res.statusCode).toBe(500);
    // Default branch: NEVER leaks err.message.
    expect(res.json()).toEqual({ error: "Internal server error" });
    await app.close();
  });

  it("Test 6: getSession returns valid session → hook completes normally (no throw, 200)", async () => {
    const auth = makeAuth(async () => ({
      user: { id: "u-1", email: "a@b.test", tenantId: "11111111-1111-1111-1111-111111111111" },
    }));
    const app = buildApp(auth);
    const res = await app.inject({
      method: "GET",
      url: "/__authed",
      headers: { authorization: "Bearer good" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toEqual({
      id: "u-1",
      email: "a@b.test",
      tenantId: "11111111-1111-1111-1111-111111111111",
    });
    await app.close();
  });
});
