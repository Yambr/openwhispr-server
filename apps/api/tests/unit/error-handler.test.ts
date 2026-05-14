// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 03 / Task 1 — RED then GREEN tests for the centralized
// `setErrorHandler` envelope (D-13). Asserts every error-class -> status
// mapping AND the envelope shape.
//
// Strategy: build a minimal Fastify instance, register the handler,
// register dummy routes that `throw` each error class, and assert the
// reply via `app.inject()`. Run-of-the-mill `throw new Error("boom")`
// must hit the default path — 500 + generic "Internal server error".
//
// We do NOT include the zod type provider here — that's a different
// failure mode (Fastify validation hooks) and is exercised at the route
// level. This file pins the SET-ERROR-HANDLER contract only.

import { ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerErrorHandler } from "../../src/error-handler.js";
import {
  AuthError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ServiceUnavailable,
  ValidationError,
} from "../../src/errors.js";
import { SSRFBlockedError } from "../../src/lib/ssrf-dispatcher.js";

describe("registerErrorHandler — global envelope (D-13)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    app.get("/throw-validation", async () => {
      throw new ValidationError("body is invalid");
    });
    app.get("/throw-zod", async () => {
      // Trigger a real ZodError via .parse — keeps the error shape authentic.
      z.object({ x: z.number() }).strict().parse({ y: 1 });
    });
    app.get("/throw-auth", async () => {
      throw new AuthError("session expired");
    });
    app.get("/throw-auth-default", async () => {
      throw new AuthError("");
    });
    app.get("/throw-notfound", async () => {
      throw new NotFoundError("user not found");
    });
    app.get("/throw-ratelimit", async () => {
      throw new RateLimitError("too many requests");
    });
    app.get("/throw-503", async () => {
      throw new ServiceUnavailable("db unavailable");
    });
    app.get("/throw-server", async () => {
      throw new ServerError("intentional bug");
    });
    app.get("/throw-plain", async () => {
      throw new Error("boom — leaks stack");
    });
    app.get("/throw-fastify-429", async () => {
      // Fastify rate-limit plugin emits errors with `statusCode === 429`.
      const err = new Error("Rate limit reached") as Error & { statusCode: number };
      err.statusCode = 429;
      throw err;
    });
    app.get("/throw-fastify-503", async () => {
      const err = new Error("db went away") as Error & { statusCode: number };
      err.statusCode = 503;
      throw err;
    });
    // Phase-2 debt back-fill — empty-message variants force the `||
    // "<default>"` fallback branches at lines 76/82/85/88/91 of
    // error-handler.ts. The AuthError empty-message branch is already
    // covered above by `/throw-auth-default`.
    app.get("/throw-validation-empty", async () => {
      throw new ValidationError("");
    });
    app.get("/throw-notfound-empty", async () => {
      throw new NotFoundError("");
    });
    app.get("/throw-ratelimit-empty", async () => {
      // RateLimitError thrown with empty message AND no statusCode
      // surface — fv.statusCode is undefined, instanceof RateLimitError
      // is true, so the branch enters the "Too many requests" default.
      const e = new RateLimitError("");
      throw e;
    });
    app.get("/throw-503-empty", async () => {
      throw new ServiceUnavailable("");
    });
    app.get("/throw-server-empty", async () => {
      throw new ServerError("");
    });
    // Phase 6 / Plan 06-12e — SSRF: direct throw AND undici-wrapped via
    // err.cause.  Node 24's globalThis.fetch wraps connect.lookup errors
    // as `new TypeError('fetch failed', { cause: <original> })`, so the
    // SSRFBlockedError raised by the dispatcher surfaces at the route's
    // catch-chain as the `.cause` of a TypeError.  The error-handler MUST
    // unwrap the cause chain to map it to 502.
    app.get("/throw-ssrf-direct", async () => {
      throw new SSRFBlockedError("link_local_v4", "169.254.169.254", "169.254.169.254");
    });
    app.get("/throw-ssrf-wrapped", async () => {
      const inner = new SSRFBlockedError("link_local_v4", "169.254.169.254", "169.254.169.254");
      throw new TypeError("fetch failed", { cause: inner });
    });
    app.get("/throw-ssrf-nested", async () => {
      // Defense-in-depth: undici can wrap twice in some edge paths
      // (connect error → AbortError → TypeError).  Walk the whole chain.
      const inner = new SSRFBlockedError("host_not_allowed", "metadata.internal");
      const mid = Object.assign(new Error("connect failed"), { cause: inner });
      throw new TypeError("fetch failed", { cause: mid });
    });
    // Fastify-style err.statusCode === 429 with empty message — exercises
    // the `errMessage || "Too many requests"` default on the same branch.
    app.get("/throw-fastify-429-empty", async () => {
      const err = new Error("") as Error & { statusCode: number };
      err.statusCode = 429;
      throw err;
    });
    app.get("/throw-fastify-503-empty", async () => {
      const err = new Error("") as Error & { statusCode: number };
      err.statusCode = 503;
      throw err;
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("maps ValidationError -> 400 with envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-validation" });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    const body = res.json();
    expect(() => ErrorEnvelope.parse(body)).not.toThrow();
    expect(body.error).toBe("body is invalid");
  });

  it("maps a real ZodError -> 400 with envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-zod" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(() => ErrorEnvelope.parse(body)).not.toThrow();
    // First issue surfaces as the message — non-empty string.
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("maps AuthError -> 401 with envelope (PITFALLS #1: NEVER 200)", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-auth" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("session expired");
  });

  it("maps AuthError with empty message to default 'Session expired'", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-auth-default" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Session expired");
  });

  it("maps NotFoundError -> 404 with envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-notfound" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("user not found");
  });

  it("maps RateLimitError -> 429 with envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-ratelimit" });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("too many requests");
  });

  it("maps ServiceUnavailable -> 503 with envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-503" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("db unavailable");
  });

  it("maps ServerError -> 500 with envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-server" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("intentional bug");
  });

  it("maps fastify-rate-limit-style err.statusCode=429 -> 429", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-fastify-429" });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("Rate limit reached");
  });

  it("maps fastify err.statusCode=503 -> 503", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-fastify-503" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("db went away");
  });

  it("maps SSRFBlockedError thrown directly -> 502 with canonical message (D-S5)", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-ssrf-direct" });
    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(() => ErrorEnvelope.parse(body)).not.toThrow();
    expect(body.error).toBe("Upstream blocked by SSRF policy");
  });

  it("maps SSRFBlockedError wrapped in TypeError('fetch failed') via err.cause -> 502 (Node 24 undici fetch contract, Phase 6 / Plan 06-12e)", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-ssrf-wrapped" });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("Upstream blocked by SSRF policy");
  });

  it("walks the entire cause chain to find SSRFBlockedError (defense in depth — Phase 6 / Plan 06-12e)", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-ssrf-nested" });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("Upstream blocked by SSRF policy");
  });

  it("default path: plain Error -> 500 with GENERIC message (no stack leak)", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-plain" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(() => ErrorEnvelope.parse(body)).not.toThrow();
    // Generic message — must NOT echo the original "boom — leaks stack".
    expect(body.error).toBe("Internal server error");
    // Defense-in-depth: response body must not contain a stack frame.
    const raw = res.body;
    expect(raw).not.toContain("at ");
    expect(raw).not.toContain("error-handler.test.ts");
  });

  it("ValidationError with empty message defaults to 'Invalid request'", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-validation-empty" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Invalid request");
  });

  it("NotFoundError with empty message defaults to 'Not found'", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-notfound-empty" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Not found");
  });

  it("RateLimitError with empty message defaults to 'Too many requests'", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-ratelimit-empty" });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("Too many requests");
  });

  it("ServiceUnavailable with empty message defaults to 'Service temporarily unavailable'", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-503-empty" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("Service temporarily unavailable");
  });

  it("ServerError with empty message defaults to 'Internal server error'", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-server-empty" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("Internal server error");
  });

  it("fastify-style err.statusCode=429 with empty message → 'Too many requests'", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-fastify-429-empty" });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("Too many requests");
  });

  it("fastify-style err.statusCode=503 with empty message → 'Service temporarily unavailable'", async () => {
    const res = await app.inject({ method: "GET", url: "/throw-fastify-503-empty" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("Service temporarily unavailable");
  });

  it("every error response has Content-Type application/json; charset=utf-8", async () => {
    const urls = [
      "/throw-validation",
      "/throw-zod",
      "/throw-auth",
      "/throw-notfound",
      "/throw-ratelimit",
      "/throw-503",
      "/throw-server",
      "/throw-plain",
    ];
    for (const url of urls) {
      const res = await app.inject({ method: "GET", url });
      expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    }
  });
});
