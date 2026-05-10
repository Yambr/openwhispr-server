// Phase 2 / Plan 03 / Task 1 — centralized `setErrorHandler` (D-13).
//
// This is the SINGLE emission point for the global `{error:<string>}`
// envelope. Every route MUST throw a typed error class (see `errors.ts`)
// rather than calling `reply.status(...).send({error:...})` inline. The
// test suite at `error-handler.test.ts` pins every mapping AND asserts
// the envelope shape via `ErrorEnvelope.parse(body)`.
//
// PITFALLS #1 (200-with-error on auth failure) is structurally
// impossible if every auth failure surfaces as `throw new AuthError(...)`.
// The `conventions.test.ts` suite (Plan 06) loops every authenticated
// endpoint and asserts 401 against bad creds.
//
// Status code map (matches RESEARCH-WIRE § Centralized Error Envelope):
//   ZodError / err.validation / ValidationError -> 400
//   AuthError                                    -> 401
//   NotFoundError                                -> 404
//   RateLimitError / err.statusCode === 429      -> 429
//   ServiceUnavailable / err.statusCode === 503  -> 503
//   ServerError                                  -> 500 (explicit)
//   default                                      -> 500 (generic message)
//
// Defensive: the default path emits "Internal server error" rather than
// `err.message` to avoid leaking internal state. Stack traces NEVER leak
// — the full error is logged server-side via `req.log.warn`.

import { APIError } from "better-auth/api";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  AuthError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ServiceUnavailable,
  ValidationError,
} from "./errors.js";
import { resolveApiErrorStatus } from "./lib/api-error-status.js";

const JSON_CT = "application/json; charset=utf-8";

interface FastifyValidationLike {
  validation?: unknown;
  statusCode?: number;
  message?: string;
}

export function registerErrorHandler(app: FastifyInstance): void {
  // Phase 02.21 / Residual A — emit the canonical envelope on unmatched
  // routes. Throw NotFoundError so the single setErrorHandler below is the
  // sole emission point (D-13). Without this, Fastify's default 404 body
  // (`{message,error,statusCode}`) would leak through and the dual-auth
  // hook would 401 unmatched routes (its skip on undefined route is the
  // companion fix in middleware/dual-auth.ts).
  app.setNotFoundHandler((_req, _reply) => {
    throw new NotFoundError("not found");
  });

  app.setErrorHandler((err, req, reply) => {
    let status = 500;
    let message = "Internal server error";

    const fv = err as FastifyValidationLike;
    const errMessage = err instanceof Error ? err.message : "";

    if (err instanceof ZodError) {
      status = 400;
      const first = err.issues[0];
      message = first?.message ?? "Invalid request";
    } else if (fv.validation !== undefined) {
      // Fastify's own schema-validation failures arrive with `validation`.
      status = 400;
      message = errMessage || "Invalid request";
    } else if (err instanceof ValidationError) {
      status = 400;
      message = err.message || "Invalid request";
    } else if (err instanceof AuthError) {
      status = 401;
      message = err.message || "Session expired";
    } else if (err instanceof NotFoundError) {
      status = 404;
      message = err.message || "Not found";
    } else if (err instanceof RateLimitError || fv.statusCode === 429) {
      status = 429;
      message = errMessage || "Too many requests";
    } else if (err instanceof ServiceUnavailable || fv.statusCode === 503) {
      status = 503;
      message = errMessage || "Service temporarily unavailable";
    } else if (err instanceof ServerError) {
      status = 500;
      message = err.message || "Internal server error";
    } else if (err instanceof APIError) {
      // Phase 02.7 D-02 Layer 2: Better Auth's `/api/auth/*` plugin routes
      // (sign-in, verify-email, sign-out) raise APIError directly when
      // their own validations fail. These bypass dualAuthHook (auth=false
      // on the namespace) and arrive here. Map to canonical envelope per
      // status; NEVER emit `err.message` (avoids leaking internal state /
      // upstream messages — WIRE-17 + threat T-02.7-09).
      const apiStatus = resolveApiErrorStatus(err);
      if (apiStatus === 401 || apiStatus === 403) {
        status = apiStatus;
        message = "Session expired";
      } else if (apiStatus === 400) {
        status = 400;
        message = "Invalid request";
      } else if (apiStatus >= 500) {
        status = 500;
        message = "Internal server error";
      } else {
        status = apiStatus;
        message = "Request failed";
      }
    }
    // Default: status=500, message="Internal server error" (NO err.message
    // — the catch-all path NEVER leaks the underlying message).

    // Server-side logging — full error including stack. Never reaches the
    // client.
    req.log.warn({ err, status }, "request error");

    reply.status(status).type(JSON_CT).send({ error: message });
  });
}
