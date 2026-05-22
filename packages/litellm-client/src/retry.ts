// SPDX-License-Identifier: FSL-1.1-ALv2
// litellm-patterns A4 — Retry-After-aware retry layer for the LiteLLM
// client. Harvested from the LiteLLM v1.83.14 utils.py
// `_should_retry` / `_calculate_retry_after` design notes (advisor D2,
// 2026-05-23).
//
// Scope (hard constraints):
//   * `chatCompletions` only — wrapped in `buildLitellmClient`.
//   * `chatCompletionsStream` MUST NOT be retried (a partially-consumed
//     SSE body cannot be safely replayed). Enforced by construction —
//     the stream method simply never calls into this loop.
//   * `audioTranscriptions` is EXCLUDED in v1 — its body is a single-use
//     `Readable` (a future phase can buffer-and-retry).
//
// The helpers here are pure / "pure-ish" (abortableSleep uses
// setTimeout); the loop itself lives inline in `buildLitellmClient`.

import { LitellmUpstreamError } from "./errors.js";

/**
 * litellm-patterns A4 — node + undici connection-class error codes that
 * mean "the request never reached a coherent HTTP response from the
 * upstream". They are DETECTION CONSTANTS, not credentials or hostnames;
 * see LOCKER-03 — they are not secret-shaped.
 */
const RETRYABLE_CONNECTION_CODES = new Set<string>([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * litellm-patterns A4 — decide retryability. A {@link LitellmUpstreamError}
 * is retryable when `err.kind` is `rate_limit` (429) or `server` (other
 * 5xx); never when `auth` (401/403) or `client` (other 4xx). A non-HTTP
 * connection-class error (ECONNRESET etc.) is also retryable.
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof LitellmUpstreamError) {
    return err.kind === "rate_limit" || err.kind === "server";
  }
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code;
    if (typeof code === "string" && RETRYABLE_CONNECTION_CODES.has(code)) {
      return true;
    }
  }
  return false;
}

/**
 * litellm-patterns A4 — compute the backoff delay (ms) before the next
 * attempt.
 *
 * If `retryAfterMs` is a positive number within `capMs`, honor it
 * verbatim — the upstream has told us when it expects to recover and a
 * good caller respects that. Otherwise fall back to exponential
 * (`baseMs * 2^attempt`) with FULL JITTER (`Math.random() * raw`),
 * bounded by `capMs`. Full jitter prevents the synchronized-retry
 * thundering-herd documented in the AWS Architecture Blog "exponential
 * backoff and jitter" paper.
 *
 * @param attempt        Zero-based attempt index (0 = before first retry).
 * @param retryAfterMs   Parsed upstream `Retry-After` in ms, or undefined.
 * @param baseMs         Exponential base (ms).
 * @param capMs          Absolute upper bound on the returned delay (ms).
 */
export function computeBackoffMs(
  attempt: number,
  retryAfterMs: number | undefined,
  baseMs: number,
  capMs: number,
): number {
  if (
    retryAfterMs !== undefined &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs >= 0 &&
    retryAfterMs <= capMs
  ) {
    return retryAfterMs;
  }
  const raw = baseMs * 2 ** attempt;
  const jittered = Math.random() * raw;
  return Math.max(0, Math.min(jittered, capMs));
}

/**
 * litellm-patterns A4 — `setTimeout`-backed sleep that resolves early
 * (without rejecting) when the caller's {@link AbortSignal} fires. Used
 * inside the retry loop so a user-cancelled `chatCompletions` does not
 * sit through an 8-second backoff.
 *
 * Implementation note: the abort listener is `{ once: true }` and the
 * timeout is `clearTimeout`'d on abort, so neither the timer nor the
 * listener leaks after either path resolves. A pre-aborted signal
 * resolves on the next microtask without scheduling any timer.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
