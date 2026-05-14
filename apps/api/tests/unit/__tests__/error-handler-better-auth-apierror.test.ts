// SPDX-License-Identifier: Apache-2.0
// Phase 02.7 / Plan 03 / Task 2 — D-02 Layer 2 (RED → GREEN).
//
// Source-of-record commit: <filled at commit time>
// Reverts: removing the `else if (err instanceof APIError)` branch in
//   apps/api/src/error-handler.ts → all five APIError tests RED (every
//   APIError falls through to the default 500 "Internal server error"
//   branch, breaking WIRE-17 envelope conformance for /api/auth/* plugin
//   routes that throw APIError directly).
//
// Background: Better Auth's `/api/auth/*` route plugin (sign-in,
// verify-email, sign-out) raises APIError on its own validations. These
// throws bypass dualAuthHook entirely (no hook on auth-namespace routes
// — auth=false config) and land in setErrorHandler. Without the
// recognizer branch, every such error produces a generic 500.
//
// A1 finding (2026-05-09): APIError.status is STRING-NAME (e.g.
// "UNAUTHORIZED") in v1.6.9. resolveApiErrorStatus handles this AND a
// future numeric variant defensively.

import { ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import { APIError } from "better-auth/api";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.get("/test-401", async () => {
    throw APIError.fromStatus("UNAUTHORIZED", { message: "invalid bearer" });
  });
  app.get("/test-403", async () => {
    throw APIError.fromStatus("FORBIDDEN", { message: "no access" });
  });
  app.get("/test-400", async () => {
    throw APIError.fromStatus("BAD_REQUEST", { message: "bad payload" });
  });
  app.get("/test-500", async () => {
    throw APIError.fromStatus("INTERNAL_SERVER_ERROR", {
      message: "upstream blew up",
    });
  });
  app.get("/test-non-apierror", async () => {
    throw new Error("something else");
  });
  app.get("/test-409", async () => {
    throw APIError.fromStatus("CONFLICT", { message: "dup email" });
  });
  return app;
}

describe("setErrorHandler — Better Auth APIError recognizer (D-02 Layer 2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("APIError(UNAUTHORIZED) → 401 + canonical envelope; never leaks err.message", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/test-401" });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    ErrorEnvelope.parse(body); // strict envelope shape
    expect(body.error).not.toContain("invalid bearer"); // no leak
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
    await app.close();
  });

  it("APIError(FORBIDDEN) → 403 + canonical envelope; no leak", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/test-403" });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    ErrorEnvelope.parse(body);
    expect(body.error).not.toContain("no access");
    await app.close();
  });

  it("APIError(BAD_REQUEST) → 400 + canonical envelope; no leak", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/test-400" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    ErrorEnvelope.parse(body);
    expect(body.error).not.toContain("bad payload");
    await app.close();
  });

  it("APIError(INTERNAL_SERVER_ERROR) → 500 + canonical envelope; never leaks 'upstream blew up'", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/test-500" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    ErrorEnvelope.parse(body);
    expect(body.error).toBe("Internal server error");
    expect(body.error).not.toContain("upstream blew up");
    await app.close();
  });

  it("APIError(CONFLICT=409) → 409 + generic 'Request failed' envelope (other-4xx branch)", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/test-409" });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    ErrorEnvelope.parse(body);
    expect(body.error).toBe("Request failed");
    expect(body.error).not.toContain("dup email");
    await app.close();
  });

  it("regression: non-APIError still hits default 500 branch with canonical envelope", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/test-non-apierror" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    ErrorEnvelope.parse(body);
    expect(body.error).toBe("Internal server error");
    expect(body.error).not.toContain("something else");
    await app.close();
  });
});
