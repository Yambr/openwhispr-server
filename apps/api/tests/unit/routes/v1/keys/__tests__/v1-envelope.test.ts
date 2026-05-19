// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 56-06 D-3 — focused unit test for the v1/keys scoped error
// handler at apps/api/src/routes/v1/keys/v1-envelope.ts.
//
// Boots a hermetic Fastify scope (no DB, no real route plugin) so each
// `setErrorHandler` branch can be exercised in isolation. Covers every
// status-code mapping the production handler implements:
//
//   ZodError                       -> 400 VALIDATION_ERROR
//   FST_ERR_CTP_* (fastify CT err) -> 400 VALIDATION_ERROR
//   fastify-validation (.validation set) -> 400 with coded
//   ValidationError                -> 400 (carries .code)
//   AuthError (default code)       -> 401 UNAUTHORIZED (coerced)
//   AuthError (explicit code)      -> 401 (preserves .code)
//   NotFoundError                  -> 404 (carries .code)
//   ConflictError                  -> 409 (carries .code)
//   RateLimitError                 -> 429 (carries .code)
//   fv.statusCode === 429          -> 429 RATE_LIMITED
//   ServiceUnavailable             -> 503 (carries .code)
//   fv.statusCode === 503          -> 503 SERVICE_UNAVAILABLE
//   ServerError                    -> 500 (carries .code)
//   unknown error                  -> 500 INTERNAL
//
// Also asserts:
//   - i18n localisation path (req.i18n.t is called with `errors.<code>`)
//   - reply content-type is application/json; charset=utf-8
//   - HTTP status NEVER masked as 200 on any failure branch

import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AuthError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ServiceUnavailable,
  ValidationError,
} from "../../../../../../src/errors.js";
import {
  registerV1EnvelopeErrorHandler,
  withV1Envelope,
} from "../../../../../../src/routes/v1/keys/v1-envelope.js";

let app: FastifyInstance;

afterEach(async () => {
  if (app) await app.close();
});

async function buildAppThrowing(throwFn: () => never | Promise<never>): Promise<FastifyInstance> {
  const a = Fastify({ logger: false });
  registerV1EnvelopeErrorHandler(a);
  a.get("/boom", async () => {
    await throwFn();
    return { ok: true };
  });
  await a.ready();
  return a;
}

describe("v1-envelope — registerV1EnvelopeErrorHandler", () => {
  it("ZodError → 400 + {success:false, error, code:VALIDATION_ERROR}", async () => {
    app = await buildAppThrowing(() => {
      // Triggering a real ZodError keeps the issue array populated so
      // the handler picks up first.message.
      z.object({ name: z.string() }).parse({});
      throw new Error("unreachable");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(400);
    expect(r.statusCode).not.toBe(200);
    expect(r.headers["content-type"]).toContain("application/json");
    const body = r.json() as { success: false; error: string; code: string };
    expect(body.success).toBe(false);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("FST_ERR_CTP_* → 400 + code:VALIDATION_ERROR", async () => {
    app = await buildAppThrowing(() => {
      const err = new Error("Malformed body") as Error & { code: string };
      err.code = "FST_ERR_CTP_INVALID_MEDIA_TYPE";
      throw err;
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { success: false; code: string };
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("fastify .validation set → 400 + coded message", async () => {
    app = await buildAppThrowing(() => {
      const err = new Error("body should be object") as Error & {
        validation: unknown[];
        code: string;
      };
      err.validation = [{ message: "x" }];
      err.code = "FST_ERR_VALIDATION";
      throw err;
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { success: false; error: string };
    expect(body.error).toMatch(/should be object/);
  });

  it("ValidationError → 400 with carried code", async () => {
    app = await buildAppThrowing(() => {
      throw new ValidationError("MY_VALIDATION", "bad input");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { success: false; code: string; error: string };
    expect(body.code).toBe("MY_VALIDATION");
    expect(body.error).toBe("bad input");
  });

  it("AuthError (default class code) → 401 with code coerced to UNAUTHORIZED", async () => {
    app = await buildAppThrowing(() => {
      throw new AuthError("session expired"); // single-arg => default class code AUTH_ERROR
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(401);
    expect(r.statusCode).not.toBe(200);
    const body = r.json() as { success: false; code: string };
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("AuthError (explicit code) → 401 preserves caller code", async () => {
    app = await buildAppThrowing(() => {
      throw new AuthError("SESSION_REVOKED", "session revoked");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(401);
    const body = r.json() as { success: false; code: string };
    expect(body.code).toBe("SESSION_REVOKED");
  });

  it("NotFoundError → 404", async () => {
    app = await buildAppThrowing(() => {
      throw new NotFoundError("THING_GONE", "thing not here");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(404);
    const body = r.json() as { success: false; code: string };
    expect(body.code).toBe("THING_GONE");
  });

  it("ConflictError → 409", async () => {
    app = await buildAppThrowing(() => {
      throw new ConflictError("DUP", "dup");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(409);
    const body = r.json() as { success: false; code: string };
    expect(body.code).toBe("DUP");
  });

  it("RateLimitError → 429", async () => {
    app = await buildAppThrowing(() => {
      throw new RateLimitError("RATE", "too many");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(429);
    const body = r.json() as { success: false; code: string };
    expect(body.code).toBe("RATE");
  });

  it("fv.statusCode === 429 → 429 RATE_LIMITED", async () => {
    app = await buildAppThrowing(() => {
      const err = new Error("blocked") as Error & { statusCode: number };
      err.statusCode = 429;
      throw err;
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(429);
    const body = r.json() as { success: false; code: string };
    expect(body.code).toBe("RATE_LIMITED");
  });

  it("ServiceUnavailable → 503", async () => {
    app = await buildAppThrowing(() => {
      throw new ServiceUnavailable("DB_DOWN", "db down");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(503);
    const body = r.json() as { success: false; code: string };
    expect(body.code).toBe("DB_DOWN");
  });

  it("fv.statusCode === 503 → 503 SERVICE_UNAVAILABLE", async () => {
    app = await buildAppThrowing(() => {
      const err = new Error("temp") as Error & { statusCode: number };
      err.statusCode = 503;
      throw err;
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(503);
    const body = r.json() as { success: false; code: string };
    expect(body.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("ServerError → 500 with carried code", async () => {
    app = await buildAppThrowing(() => {
      throw new ServerError("MIGRATION_FAIL", "boom");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(500);
    const body = r.json() as { success: false; code: string };
    expect(body.code).toBe("MIGRATION_FAIL");
  });

  it("unknown error → 500 INTERNAL", async () => {
    app = await buildAppThrowing(() => {
      throw new Error("plain");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(500);
    const body = r.json() as { success: false; code: string };
    expect(body.code).toBe("INTERNAL");
  });

  // Defensive fallback-message branches — every status-mapped class can
  // be thrown with an empty `message` (the constructor supports it via
  // `arg1 ?? ""` in errors.ts). The handler MUST fall back to the
  // per-status default literal rather than emitting an empty `error`
  // string (which would violate the contract).

  it("empty-message ValidationError → emits 'Invalid request' fallback", async () => {
    app = await buildAppThrowing(() => {
      throw new ValidationError("EMPTY_VAL", "");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    const body = r.json() as { error: string };
    expect(body.error).toBe("Invalid request");
  });

  it("empty-message AuthError → emits 'Unauthorized' fallback", async () => {
    app = await buildAppThrowing(() => {
      throw new AuthError("EMPTY_AUTH", "");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    const body = r.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("empty-message NotFoundError → emits 'Not found' fallback", async () => {
    app = await buildAppThrowing(() => {
      throw new NotFoundError("EMPTY_404", "");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    const body = r.json() as { error: string };
    expect(body.error).toBe("Not found");
  });

  it("empty-message ConflictError → emits 'Conflict' fallback", async () => {
    app = await buildAppThrowing(() => {
      throw new ConflictError("EMPTY_409", "");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    const body = r.json() as { error: string };
    expect(body.error).toBe("Conflict");
  });

  it("empty-message ServiceUnavailable → emits 'Service temporarily unavailable' fallback", async () => {
    app = await buildAppThrowing(() => {
      throw new ServiceUnavailable("EMPTY_503", "");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    const body = r.json() as { error: string };
    expect(body.error).toBe("Service temporarily unavailable");
  });

  it("empty-message ServerError → emits 'Internal server error' fallback", async () => {
    app = await buildAppThrowing(() => {
      throw new ServerError("EMPTY_500", "");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    const body = r.json() as { error: string };
    expect(body.error).toBe("Internal server error");
  });

  it("empty-message RateLimitError → emits 'Too many requests' fallback", async () => {
    app = await buildAppThrowing(() => {
      // Throw a non-Error so `err instanceof Error ? err.message : ""`
      // returns "" — exercises the errMessage-empty fallback branch
      // shared by RateLimitError / fv.statusCode === 429 / 503.
      throw new RateLimitError("EMPTY_429", "");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    const body = r.json() as { error: string };
    expect(body.error).toBe("Too many requests");
  });

  it("fv.statusCode === 429 with empty message → fallback 'Too many requests'", async () => {
    app = await buildAppThrowing(() => {
      const err = new Error("") as Error & { statusCode: number };
      err.statusCode = 429;
      throw err;
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    const body = r.json() as { error: string };
    expect(body.error).toBe("Too many requests");
  });

  it("fv.statusCode === 503 with empty message → fallback 'Service temporarily unavailable'", async () => {
    app = await buildAppThrowing(() => {
      const err = new Error("") as Error & { statusCode: number };
      err.statusCode = 503;
      throw err;
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    const body = r.json() as { error: string };
    expect(body.error).toBe("Service temporarily unavailable");
  });

  it("ZodError with no issues → 'Invalid request' fallback", async () => {
    app = await buildAppThrowing(() => {
      // Synthesize a ZodError with an empty issues array — exercises
      // the `first?.message ?? "Invalid request"` short-circuit.
      throw new z.ZodError([]);
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    const body = r.json() as { error: string };
    expect(body.error).toBe("Invalid request");
  });

  it("fastify .validation set with no message → 'Invalid request' fallback", async () => {
    app = await buildAppThrowing(() => {
      const err = new Error("") as Error & { validation: unknown[] };
      err.validation = [];
      throw err;
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    const body = r.json() as { error: string };
    expect(body.error).toBe("Invalid request");
  });

  it("localises via req.i18n.t when present", async () => {
    const a = Fastify({ logger: false });
    registerV1EnvelopeErrorHandler(a);
    a.addHook("onRequest", async (req: FastifyRequest) => {
      // Mock the i18n shape the FastifyRequest augmentation declares.
      (req as FastifyRequest & { i18n: { t: (k: string, o?: object) => string } }).i18n = {
        t: (key: string, _opts?: object) => `[loc:${key}]`,
      };
    });
    a.get("/boom", async () => {
      throw new ConflictError("MY_CONFLICT", "raw");
    });
    await a.ready();
    try {
      const r = await a.inject({ method: "GET", url: "/boom" });
      expect(r.statusCode).toBe(409);
      const body = r.json() as { error: string; code: string };
      expect(body.error).toBe("[loc:errors.MY_CONFLICT]");
      expect(body.code).toBe("MY_CONFLICT");
    } finally {
      await a.close();
    }
  });
});

describe("v1-envelope — withV1Envelope wrapper", () => {
  it("wraps a plugin so its throws hit the scoped handler", async () => {
    const wrapped = withV1Envelope(async (scope) => {
      scope.get("/wrapped", async () => {
        throw new NotFoundError("WRAPPED_404", "nope");
      });
    });
    const a = Fastify({ logger: false });
    await a.register(wrapped);
    await a.ready();
    try {
      const r = await a.inject({ method: "GET", url: "/wrapped" });
      expect(r.statusCode).toBe(404);
      const body = r.json() as { success: false; code: string };
      expect(body.success).toBe(false);
      expect(body.code).toBe("WRAPPED_404");
    } finally {
      await a.close();
    }
  });

  it("does NOT leak the v1 handler beyond the scope (outer route uses default)", async () => {
    const a = Fastify({ logger: false });
    // No global setErrorHandler — outer scope falls back to fastify default.
    await a.register(
      withV1Envelope(async (scope) => {
        scope.get("/inside", async () => {
          throw new NotFoundError("INNER_404", "x");
        });
      }),
    );
    a.get("/outside", async () => {
      throw new NotFoundError("OUTER_404", "y");
    });
    await a.ready();
    try {
      const inside = await a.inject({ method: "GET", url: "/inside" });
      expect(inside.statusCode).toBe(404);
      const inBody = inside.json() as { success: false; code: string };
      expect(inBody.success).toBe(false); // v1 envelope shape

      const outside = await a.inject({ method: "GET", url: "/outside" });
      // The default Fastify handler would 500 a plain Error; outside the
      // v1 scope, the NotFoundError class is unknown and surfaces as 500
      // with fastify's default `{statusCode,error,message}` envelope.
      // Critically, the body MUST NOT contain `success` — proving the
      // v1 handler did not leak.
      const outBody = outside.json() as Record<string, unknown>;
      expect(outBody).not.toHaveProperty("success");
    } finally {
      await a.close();
    }
  });
});
