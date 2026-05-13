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
  ConflictError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ServiceUnavailable,
  UpstreamError,
  ValidationError,
} from "./errors.js";
import { resolveApiErrorStatus } from "./lib/api-error-status.js";
import { SSRFBlockedError } from "./lib/ssrf-dispatcher.js";

const JSON_CT = "application/json; charset=utf-8";

/**
 * Phase 10 / Plan 10-01a — translate the canonical envelope message via
 * req.i18n when present. Falls back to `fallback` (which is either the
 * constructor-supplied `err.message` or the per-class default literal
 * the handler already computed) when:
 *   - the request has no `i18n` (i18nPlugin not registered — legacy
 *     boot path, existing tests). This preserves the contract pinned by
 *     apps/api/src/error-handler.test.ts (advisor B10).
 *   - `code` is undefined (Better Auth APIError, ZodError, fastify
 *     validation, default catch-all — none of these expose a stable
 *     typed-error code in Plan 10-01a's scope; 10-01d will broaden the
 *     surface).
 */
function localize(
  req: { i18n?: { t(k: string, o?: object): string } },
  code: string | undefined,
  fallback: string,
): string {
  const t = req.i18n?.t;
  if (!t || !code) return fallback;
  return t.call(req.i18n, `errors.${code}`, { defaultValue: fallback });
}

/**
 * Phase 6 / Plan 06-12e — walk `err.cause` chain to find an
 * `SSRFBlockedError`.
 *
 * Node 24's `globalThis.fetch` (built on undici) wraps any error raised
 * from the `connect.lookup` hook as
 * `new TypeError('fetch failed', { cause: <original> })`.  Our SSRF
 * dispatcher raises `SSRFBlockedError` from that hook, so the typed
 * error surfaces at the route's catch-chain as the `.cause` of a
 * TypeError, NOT as the top-level error.  Without unwrapping, the
 * setErrorHandler's `err instanceof SSRFBlockedError` check never
 * matches and SSRF-blocked outbound calls return 500 instead of the
 * canonical 502 envelope (D-S5).
 *
 * Defense in depth: in some edge paths undici can wrap twice (connect
 * error → AbortError → TypeError) so the walker handles arbitrary
 * depth, bounded by `MAX_CAUSE_DEPTH` to defend against pathological
 * cycles.
 */
const MAX_CAUSE_DEPTH = 8;
export function findSSRFBlockedError(err: unknown): SSRFBlockedError | null {
  let current: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (current instanceof SSRFBlockedError) return current;
    if (current === null || typeof current !== "object") return null;
    const next = (current as { cause?: unknown }).cause;
    if (next === current || next === undefined) return null;
    current = next;
  }
  return null;
}

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
    // Phase 10 / Plan 10-01a — when set, the handler will look up
    // `errors.<code>` via req.i18n before emitting `message`. Left
    // undefined for non-typed errors (ZodError, fastify validation,
    // APIError, default catch-all) to preserve their existing literal
    // emission semantics.
    let code: string | undefined;

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
      code = err.code;
    } else if (err instanceof AuthError) {
      status = 401;
      message = err.message || "Session expired";
      code = err.code;
    } else if (err instanceof NotFoundError) {
      status = 404;
      message = err.message || "Not found";
      code = err.code;
    } else if (err instanceof ConflictError) {
      // Phase 10 / Plan 10-01d — 409 surface for uniqueness / version
      // conflicts (replaces inline `reply.code(409).send(...)` sites).
      status = 409;
      message = err.message || "Conflict";
      code = err.code;
    } else if (err instanceof UpstreamError) {
      // Phase 10 / Plan 10-01d — 502 envelope for third-party failures.
      // Distinct from ServiceUnavailable (503 — our infra) and from
      // SSRFBlockedError (502 — outbound policy block, handled below).
      status = 502;
      message = err.message || "Upstream error";
      code = err.code;
    } else if (err instanceof RateLimitError) {
      status = 429;
      message = errMessage || "Too many requests";
      code = err.code;
    } else if (fv.statusCode === 429) {
      status = 429;
      message = errMessage || "Too many requests";
    } else if (err instanceof ServiceUnavailable) {
      status = 503;
      message = errMessage || "Service temporarily unavailable";
      code = err.code;
    } else if (fv.statusCode === 503) {
      status = 503;
      message = errMessage || "Service temporarily unavailable";
    } else if (err instanceof ServerError) {
      status = 500;
      message = err.message || "Internal server error";
      code = err.code;
    } else if (findSSRFBlockedError(err) !== null) {
      // Phase 6 / Plan 06 (SCALE-04, D-S5) — outbound blocked by SSRF
      // gate. 502 envelope; audit_log row already written by the
      // dispatcher's onBlock callback (action='security.ssrf_blocked').
      // Plan 06-12e — walk err.cause chain because Node 24's
      // `globalThis.fetch` wraps connect-lookup errors as
      // `TypeError('fetch failed', { cause: <original> })`.  Direct
      // throws still match because the helper short-circuits at depth=0.
      status = 502;
      message = "Upstream blocked by SSRF policy";
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

    // Phase 10 / Plan 10-01a — localize typed-error messages via
    // i18next using `req.i18n` (steered by Accept-Language). When code
    // is undefined (non-typed errors) OR req.i18n is missing (legacy
    // boot), `message` flows through untouched.
    const localized = localize(
      req as unknown as { i18n?: { t(k: string, o?: object): string } },
      code,
      message,
    );
    reply.status(status).type(JSON_CT).send({ error: localized });
  });
}
