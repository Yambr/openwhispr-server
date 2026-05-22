// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 Plan 03 Task 1 — typed error classes for LiteLLM client.
//
// Two distinct error types so route handlers can map cleanly:
//   * MissingProviderKeyError -> 503 envelope (operator-actionable: set
//     OPENROUTER_API_KEY / GROQ_API_KEY / PYANNOTE_API_KEY in .env).
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

export class LitellmUpstreamError extends Error {
  public readonly status: number;
  // Phase 37 / CRIT-FIX-09 (CR-9). bodyText is truncated AT CONSTRUCTION
  // and held as a non-enumerable own property so pino's default `err`
  // serializer (which walks own enumerable properties) cannot exfiltrate
  // the upstream payload into Loki. Override of `toJSON()` below is the
  // belt-and-braces second layer (pino calls `err.toJSON()` if present).
  // Phase 52 / Plan 52-01 — `declare` because the property is installed
  // via Object.defineProperty (non-enumerable, see ctor body); TS can't
  // see that initializer. Behaviour unchanged; type-system-only fix.
  private declare readonly bodyText: string;

  constructor(status: number, bodyText: string, message?: string) {
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
   * Returning only the safe triple guarantees bodyText never reaches
   * structured-log shipping even via that path.
   */
  toJSON(): { name: string; message: string; status: number } {
    return { name: this.name, message: this.message, status: this.status };
  }
}
