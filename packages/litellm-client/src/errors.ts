// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 Plan 03 Task 1 — typed error classes for LiteLLM client.
//
// Two distinct error types so route handlers can map cleanly:
//   * MissingProviderKeyError -> 503 envelope (operator-actionable: set
//     OPENROUTER_API_KEY / GROQ_API_KEY in .env).
//     This is RESEARCH Pitfall #8 — silent 401-from-upstream looks like
//     a user auth failure to the desktop and triggers logout. We MUST
//     pre-check provider keys on the bundled-default path and surface a
//     503 with operator instructions instead.
//   * LitellmUpstreamError -> 502 envelope (LiteLLM proxy itself
//     misbehaved or the underlying provider returned non-2xx).
//
// Threat T-03-03-01 (LITELLM_MASTER_KEY in error message): bodyText is
// truncated to 200 chars and the auth header is NEVER passed through.

import { redactSecretShapes } from "./redact.js";

/**
 * Phase 41.f / HI-2 — thrown when the LiteLLM client is invoked without
 * the SSRF-wrapped undici dispatcher installed as the process-wide global.
 *
 * The client relies entirely on `setGlobalDispatcher(makeSSRFDispatcher(...))`
 * (apps/api/src/bootstrap.ts) for SSRF allow-list / block-list defence on
 * outbound LiteLLM traffic. A worker / CLI / future consumer that imports
 * `buildLitellmClient` without first running the api's SSRF bootstrap would
 * silently bypass the gate; this error fails loudly on first call instead.
 *
 * The dispatcher tag is a Symbol-keyed non-enumerable own property; the
 * registry key (`Symbol.for("openwhispr.ssrf-wrapped")`) is module-scoped
 * so the dispatcher module and the client can both compute the same symbol
 * without a circular dep.
 */
export class SsrfDispatcherNotInstalledError extends Error {
  public readonly code = "SSRF_DISPATCHER_NOT_INSTALLED";
  constructor() {
    super(
      "LiteLLM client refused to send: SSRF-wrapped undici dispatcher not installed " +
        "as the process-wide global. Call `installGlobalSSRF()` (apps/api/src/bootstrap.ts) " +
        "or pass an explicit `request` option to buildLitellmClient before invoking any method.",
    );
    this.name = "SsrfDispatcherNotInstalledError";
  }
}

export class MissingProviderKeyError extends Error {
  public readonly envVar: string;
  public readonly model: string;

  constructor(envVar: string, model: string) {
    super(`${envVar} is not configured. Set it in .env to enable model "${model}" via LiteLLM.`);
    this.name = "MissingProviderKeyError";
    this.envVar = envVar;
    this.model = model;
  }
}

/**
 * litellm-patterns A3 — discriminant for {@link LitellmUpstreamError}. A
 * caller (notably the A4 retry layer) inspects `err.kind` to decide
 * retryability without re-deriving status ranges:
 *   - `rate_limit` — 429 (retryable, honor Retry-After)
 *   - `auth`       — 401 / 403 (NOT retryable — credential problem)
 *   - `server`     — any other 5xx (retryable)
 *   - `client`     — any other 4xx / anything else >= 400 (NOT retryable)
 */
export type LitellmErrorKind = "rate_limit" | "auth" | "server" | "client";

/**
 * litellm-patterns A3 — pure status → {@link LitellmErrorKind} classifier.
 * Always called inside the client; `kind` is never a free ctor parameter
 * accepted verbatim from an untrusted caller.
 */
export function classifyUpstreamStatus(status: number): LitellmErrorKind {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "server";
  return "client";
}

/** litellm-patterns A3 — upper bound on a parsed Retry-After (ms). */
const RETRY_AFTER_CAP_MS = 60_000;

/**
 * litellm-patterns A3 — pure parser for the upstream `Retry-After` header.
 *
 * Handles BOTH RFC 7231 forms: integer delta-seconds (`Retry-After: 30`)
 * and an HTTP-date (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`). Returns
 * `undefined` for an absent, malformed, or already-elapsed value, and caps
 * the result at {@link RETRY_AFTER_CAP_MS} so a hostile or buggy upstream
 * cannot pin a request open for an hour.
 *
 * @param headerValue The raw header value (undici may surface `string[]`).
 * @param nowMs       Caller-supplied clock (testable; pass `Date.now()`).
 */
export function parseRetryAfterMs(
  headerValue: string | string[] | undefined,
  nowMs: number,
): number | undefined {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  // Delta-seconds form: a bare non-negative integer.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return Math.min(seconds * 1_000, RETRY_AFTER_CAP_MS);
  }
  // HTTP-date form.
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;
  const deltaMs = dateMs - nowMs;
  if (deltaMs < 0) return undefined;
  return Math.min(deltaMs, RETRY_AFTER_CAP_MS);
}

/**
 * litellm-patterns A3 — classification + parsed Retry-After passed into
 * the {@link LitellmUpstreamError} constructor by the client throw site.
 * `kind` defaults to {@link classifyUpstreamStatus} when omitted so a bare
 * `new LitellmUpstreamError(status, body)` stays back-compatible.
 *
 * Module-private: the constructor accepts it positionally; no external
 * consumer constructs it, so exporting it would be a LOCKER-04 dead export.
 */
interface LitellmUpstreamErrorOptions {
  /** Optional human-readable message override (truncated at construction). */
  message?: string;
  /** Classification; defaults to `classifyUpstreamStatus(status)`. */
  kind?: LitellmErrorKind;
  /** Parsed `Retry-After` in ms (safe small number); omitted when absent. */
  retryAfterMs?: number;
}

export class LitellmUpstreamError extends Error {
  public readonly status: number;
  // litellm-patterns A3 — typed classification + optional parsed
  // Retry-After. `kind` lets a caller (the A4 retry layer) branch on
  // retryability without re-deriving status ranges; `retryAfterMs` is the
  // capped, parsed upstream hint. Both are SAFE to enumerate / serialize
  // (a small enum string + a small number) so they join `toJSON()` —
  // unlike `bodyText`, which stays non-enumerable (LOCKER-05).
  public readonly kind: LitellmErrorKind;
  public readonly retryAfterMs?: number;
  // Phase 37 / CRIT-FIX-09 (CR-9). bodyText is truncated AT CONSTRUCTION
  // and held as a non-enumerable own property so pino's default `err`
  // serializer (which walks own enumerable properties) cannot exfiltrate
  // the upstream payload into Loki. Override of `toJSON()` below is the
  // belt-and-braces second layer (pino calls `err.toJSON()` if present).
  // Phase 52 / Plan 52-01 — `declare` because the property is installed
  // via Object.defineProperty (non-enumerable, see ctor body); TS can't
  // see that initializer. Behaviour unchanged; type-system-only fix.
  private declare readonly bodyText: string;

  constructor(
    status: number,
    bodyText: string,
    // litellm-patterns A3 — the third parameter is a UNION for
    // back-compat: legacy call sites (and the existing truncation tests)
    // pass a bare `message` string; A3 call sites pass an options object
    // carrying `kind` / `retryAfterMs`. A bare string is normalized to
    // `{ message }` below so neither shape regresses.
    messageOrOptions?: string | LitellmUpstreamErrorOptions,
  ) {
    const options: LitellmUpstreamErrorOptions =
      typeof messageOrOptions === "string"
        ? { message: messageOrOptions }
        : (messageOrOptions ?? {});
    const message = options.message;
    // litellm-patterns A2 — REDACT credential-shape substrings BEFORE the
    // truncation runs. Truncation alone is insufficient: a secret-shaped
    // token in the FIRST 200 chars survives `slice(0, 200)` into
    // `Error.message`. Redaction is ADDITIVE — it strengthens the
    // LOCKER-05 "truncate AT CONSTRUCTION" contract; truncation stays.
    // Both `bodyText` and the optional `message` override are redacted.
    const truncated = redactSecretShapes(bodyText).slice(0, 200);
    // Phase 68 / Plan 68-01 — REVIEW litellm-client HIGH HI-1: the
    // optional `message` override is ALSO truncated at construction. The
    // LOCKER-05 contract is "truncate AT CONSTRUCTION" — passing the
    // override to `super()` verbatim let a caller route an untruncated
    // upstream payload straight into `Error.message`. A2 adds the
    // redaction pass on the same override before truncation.
    super(
      redactSecretShapes(message ?? `LiteLLM upstream returned ${status}: ${truncated}`).slice(
        0,
        200,
      ),
    );
    this.name = "LitellmUpstreamError";
    this.status = status;
    // A3 — `kind` is derived from status when the caller did not classify
    // explicitly, so a bare `new LitellmUpstreamError(status, body)` is
    // unchanged. `retryAfterMs` is only assigned when present so the
    // optional property stays genuinely absent under
    // `exactOptionalPropertyTypes`.
    this.kind = options.kind ?? classifyUpstreamStatus(status);
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
    // Non-enumerable: drops the field from JSON.stringify(err) entirely,
    // closing the V7 STRIDE Info-Disclosure surface even if pino's err
    // serializer is bypassed by a downstream `log.warn({ err })` call.
    Object.defineProperty(this, "bodyText", {
      value: truncated,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  /**
   * pino's default `err` serializer calls `err.toJSON()` when present.
   * Returning only the safe fields guarantees `bodyText` never reaches
   * structured-log shipping even via that path. litellm-patterns A3 adds
   * `kind` (a small enum string) and — when present — `retryAfterMs` (a
   * small number); both are safe to ship. `bodyText` STAYS absent
   * (LOCKER-05 contract unchanged).
   */
  toJSON(): {
    name: string;
    message: string;
    status: number;
    kind: LitellmErrorKind;
    retryAfterMs?: number;
  } {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      kind: this.kind,
      ...(this.retryAfterMs !== undefined ? { retryAfterMs: this.retryAfterMs } : {}),
    };
  }
}
