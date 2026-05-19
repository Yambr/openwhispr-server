// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 56-06 D-3 — scoped error handler for /api/v1/keys/* routes.
//
// The global error handler (apps/api/src/error-handler.ts) emits the
// legacy `{ error: <string> }` envelope used by every non-v1 route
// family. Per the upstream client wire spec (R12), the /api/v1/keys/*
// surface MUST emit the discriminated V1 envelope on every code path:
//
//   success: { success: true, data: T }       (HTTP 2xx)
//   failure: { success: false, error: string, code?: string } (HTTP 4xx/5xx)
//
// To avoid touching the global handler (which would ripple through
// every other route family AND its pinned tests), this helper builds
// an encapsulated Fastify scope whose `setErrorHandler` translates the
// typed error classes into the v1 envelope shape. Each /api/v1/keys/*
// route is registered INSIDE the scope so its thrown errors hit the
// scoped handler, NOT the global one.
//
// Status-code map (HTTP status stays TRUTHFUL — never silently 200):
//   ZodError / err.validation / ValidationError  -> 400  VALIDATION_ERROR
//   AuthError                                    -> 401  UNAUTHORIZED
//   NotFoundError                                -> 404  NOT_FOUND
//   ConflictError                                -> 409  CONFLICT
//   RateLimitError / err.statusCode === 429      -> 429  RATE_LIMITED
//   ServiceUnavailable / err.statusCode === 503  -> 503  SERVICE_UNAVAILABLE
//   default                                      -> 500  INTERNAL
//
// `code` falls through from `err.code` when the typed-error class
// carries one (every Error subclass in apps/api/src/errors.ts implements
// `Coded`). Untyped errors emit the class-default code so clients can
// always switch on `code`.

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ZodError } from "zod";
import {
  AuthError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ServiceUnavailable,
  ValidationError,
} from "../../../errors.js";

const JSON_CT = "application/json; charset=utf-8";

interface FastifyValidationLike {
  validation?: unknown;
  statusCode?: number;
  message?: string;
  code?: string;
}

interface CodedLike {
  code?: string;
}

/**
 * Register `setErrorHandler` on the given (encapsulated) scope so that
 * any error thrown inside translates to the Phase 56-06 D-3 envelope.
 * Exported so the v1/keys/{list,create,revoke} route plugins can each
 * wrap their own `app.register(scope => ...)` call.
 */
export function registerV1EnvelopeErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    let status = 500;
    let message = "Internal server error";
    let code = "INTERNAL";

    const fv = err as FastifyValidationLike;
    const coded = err as CodedLike;
    const errMessage = err instanceof Error ? err.message : "";

    if (err instanceof ZodError) {
      status = 400;
      const first = err.issues[0];
      message = first?.message ?? "Invalid request";
      code = "VALIDATION_ERROR";
    } else if (typeof fv.code === "string" && fv.code.startsWith("FST_ERR_CTP_")) {
      // Mirrors the global handler's Fastify content-type-parser branch:
      // malformed body shapes are client errors, NOT 500s.
      status = 400;
      message = "Invalid request";
      code = "VALIDATION_ERROR";
    } else if (fv.validation !== undefined) {
      status = 400;
      message = errMessage || "Invalid request";
      code = coded.code ?? "VALIDATION_ERROR";
    } else if (err instanceof ValidationError) {
      status = 400;
      message = err.message || "Invalid request";
      code = err.code;
    } else if (err instanceof AuthError) {
      status = 401;
      message = err.message || "Unauthorized";
      // Phase 56-06 D-3 — the spec-mandated code is "UNAUTHORIZED";
      // existing AuthError instances carry "UNAUTHORIZED" already when
      // thrown by v1/keys routes (see list.ts / create.ts / revoke.ts),
      // but we coerce the default AUTH_ERROR class-code to the
      // spec-mandated value so any new AuthError() throw inside the
      // scope still hits the contract.
      code = err.code === "AUTH_ERROR" ? "UNAUTHORIZED" : err.code;
    } else if (err instanceof NotFoundError) {
      status = 404;
      message = err.message || "Not found";
      code = err.code;
    } else if (err instanceof ConflictError) {
      status = 409;
      message = err.message || "Conflict";
      code = err.code;
    } else if (err instanceof RateLimitError) {
      status = 429;
      message = errMessage || "Too many requests";
      code = err.code;
    } else if (fv.statusCode === 429) {
      status = 429;
      message = errMessage || "Too many requests";
      code = "RATE_LIMITED";
    } else if (err instanceof ServiceUnavailable) {
      status = 503;
      message = errMessage || "Service temporarily unavailable";
      code = err.code;
    } else if (fv.statusCode === 503) {
      status = 503;
      message = errMessage || "Service temporarily unavailable";
      code = "SERVICE_UNAVAILABLE";
    } else if (err instanceof ServerError) {
      status = 500;
      message = err.message || "Internal server error";
      code = err.code;
    }

    req.log.warn({ err, status }, "v1 envelope error");

    // Phase 10 i18n localisation parity — when req.i18n is attached
    // (i18nPlugin registered in production boot per the FastifyRequest
    // augmentation at apps/api/src/types/fastify.d.ts), translate via
    // the `errors.<code>` key; otherwise emit the literal message.
    // Mirrors the global handler's localize() helper without importing
    // it (keeps the v1 scope self-contained).
    const i18n = req.i18n;
    const localized = i18n?.t.call(i18n, `errors.${code}`, { defaultValue: message }) ?? message;

    reply.status(status).type(JSON_CT).send({ success: false, error: localized, code });
  });
}

/**
 * Convenience helper — encapsulate a Fastify route registration inside
 * a scope that uses the v1 envelope error handler. Used by each of the
 * v1/keys/{list,create,revoke} route plugins so their throws are
 * translated to the v1 envelope rather than the global `{error}` shape.
 */
export function withV1Envelope(inner: FastifyPluginAsync): FastifyPluginAsync {
  return async (app) => {
    await app.register(async (scope) => {
      registerV1EnvelopeErrorHandler(scope);
      await scope.register(inner);
    });
  };
}
