---
quick_id: 260523-a3a4
slug: litellm-patterns-a3a4
date: 2026-05-23
status: planned
---

# litellm-patterns A3 + A4 — typed upstream errors + Retry-After-aware retry

Harvested from the LiteLLM v1.83.14 source study (clone at
`/Users/dev/ref-clones/litellm`, `litellm/utils.py:6714` `_should_retry` /
`_calculate_retry_after`). Design decided by gsd-advisor-researcher
(2026-05-23) — D1 → Option B, D2 → Option B. Both server-side, strict TDD.

## A3 — typed 4xx/5xx classification on LitellmUpstreamError (D1 Option B)

`packages/litellm-client/src/errors.ts` — today every status ≥400 throws a
single `LitellmUpstreamError` carrying only `status`. Callers cannot tell a
retryable 429 from a non-retryable 401.

Fix — **single class, discriminant field** (NO subclasses — zero new
exports, LOCKER-04/05 blast radius stays nil, `instanceof
LitellmUpstreamError` provably unchanged):

1. Add a public readonly field `kind: "rate_limit" | "auth" | "server" | "client"`
   and an optional public readonly `retryAfterMs?: number` to
   `LitellmUpstreamError`.
2. `kind` is **always derived inside the client**, never a free ctor
   parameter accepted from a caller. Add an exported pure classifier
   `classifyUpstreamStatus(status: number): LitellmErrorKind`:
   - 429 → `"rate_limit"`
   - 401 / 403 → `"auth"`
   - any other 5xx → `"server"`
   - any other 4xx (and anything else ≥400) → `"client"`
   Export the `LitellmErrorKind` type too.
3. The `LitellmUpstreamError` constructor signature extends to accept the
   classification + parsed retry-after: `constructor(status, bodyText,
   opts?: { message?: string; kind?: LitellmErrorKind; retryAfterMs?: number })`
   — OR keep the positional `message` and add a 4th options arg. Executor's
   call; whichever keeps the existing 5 catch sites + existing tests
   compiling with the least churn. If `kind` is not supplied it defaults to
   `classifyUpstreamStatus(status)` so a bare `new LitellmUpstreamError(500,
   body)` still works (back-compat — existing call sites unchanged).
4. Widen `toJSON()` to `{ name, message, status, kind }` — `retryAfterMs`
   MAY be included (it is a safe number). `bodyText` STAYS non-enumerable
   and absent from `toJSON()` — LOCKER-05 contract untouched.
5. `errors.ts` already imports `redactSecretShapes`; the truncation +
   redaction logic is UNCHANGED — A3 is additive metadata only.
6. Parse `Retry-After` from the upstream response **headers** at the throw
   site in `index.ts` `ensureOk` (see below) and pass `retryAfterMs` into
   the error. Add an exported pure helper `parseRetryAfterMs(headerValue:
   string | string[] | undefined, nowMs: number): number | undefined` —
   handles BOTH integer delta-seconds AND HTTP-date (`Date.parse`) forms,
   returns `undefined` on absent/garbage/negative, caps at 60_000 ms.

`index.ts` — `ensureOk` becomes: read `res.headers["retry-after"]`, compute
`retryAfterMs` via `parseRetryAfterMs`, `kind` via `classifyUpstreamStatus`,
throw `new LitellmUpstreamError(status, bodyText, { kind, retryAfterMs })`.
The `chatCompletionsStream` non-2xx path (the inline `drainWithTimeout`
branch) gets the SAME classification so a streaming caller also sees
`err.kind`.

## A4 — Retry-After-aware retry layer (D2 Option B)

App-level `withRetry()` loop **inside `buildLitellmClient`**, applied **only
to `chatCompletions`**. `chatCompletionsStream` MUST NOT be retried — a
partially-consumed SSE body cannot be safely replayed; this is a hard
constraint satisfied by construction (the stream method simply never calls
`withRetry`). `audioTranscriptions` is EXCLUDED from A4 in v1 — its body is
a single-use `Readable` (document this exclusion in a code comment; a future
phase can buffer-and-retry).

Implement:
1. New file `packages/litellm-client/src/retry.ts` — pure-ish helpers:
   - `isRetryableError(err: unknown): boolean` — true for
     `LitellmUpstreamError` with `kind === "rate_limit"` or `kind ===
     "server"` (i.e. 429 + 5xx), OR a connection-class error whose `code`
     is one of `ECONNRESET` / `ECONNREFUSED` / `ETIMEDOUT` /
     `UND_ERR_CONNECT_TIMEOUT` / `UND_ERR_SOCKET`. Auth/client errors are
     NOT retryable.
   - `computeBackoffMs(attempt: number, retryAfterMs: number | undefined,
     baseMs: number, capMs: number): number` — if `retryAfterMs` is a valid
     positive number ≤ capMs use it; else exponential `baseMs * 2^attempt`
     with FULL JITTER (`Math.random() * raw`), capped at `capMs`.
   - `abortableSleep(ms: number, signal?: AbortSignal): Promise<void>` —
     resolves after `ms` OR rejects/early-resolves immediately if `signal`
     fires. Implement with `setTimeout` + a one-shot `abort` listener;
     clear the timer on abort. If already aborted, return immediately.
2. `withRetry`-style loop wrapping the `chatCompletions` body inside
   `buildLitellmClient`: up to `config.retryMaxAttempts` TOTAL attempts
   (default 3 = 1 try + 2 retries). On a caught error: if NOT
   `isRetryableError` → rethrow immediately; if it IS but attempts
   exhausted → rethrow; else compute backoff, `abortableSleep`, and if the
   caller's `req.signal` is already aborted at any point → rethrow the
   error immediately (do NOT sleep, do NOT retry). Each attempt re-builds
   the request fresh (the JSON body is trivially re-stringified — no
   single-use-body problem for `chatCompletions`).
3. `config.ts` — three new env knobs via `parsePositiveIntEnv`, each with
   an `@internal` `DEFAULT_*` literal fallback (mirror the existing R32
   timeout-knob pattern exactly):
   - `LITELLM_RETRY_MAX_ATTEMPTS` → `retryMaxAttempts` (default 3)
   - `LITELLM_RETRY_BASE_MS` → `retryBaseMs` (default 250)
   - `LITELLM_RETRY_CAP_MS` → `retryCapMs` (default 8_000)
   Add the three fields to `LitellmClientConfig` with JSDoc.
4. Per-attempt `headersTimeout`/`bodyTimeout` continue to apply per
   attempt (unchanged) — the retry budget is NOT a global deadline.

## TDD (RED→GREEN, tests in the same atomic commit as each fix)

- A3 unit (`errors.test.ts` / new): `classifyUpstreamStatus` for
  429/401/403/400/404/409/500/503/418; `parseRetryAfterMs` for
  delta-seconds, HTTP-date, absent, garbage, negative, >60s-cap; a
  `LitellmUpstreamError` carries the right `kind`/`retryAfterMs` and
  `toJSON()` includes `kind` but NOT `bodyText`; `instanceof
  LitellmUpstreamError` still catches a `kind:"rate_limit"` instance.
- A4 unit (`retry.test.ts` new): `isRetryableError` true for
  rate_limit/server + the connection codes, false for auth/client + a
  plain `Error`; `computeBackoffMs` honors `retryAfterMs`, falls back to
  jittered exponential, respects cap; `abortableSleep` resolves on timeout
  AND short-circuits on a pre-aborted / mid-flight signal.
- A4 integration-ish (`index.test.ts` — uses the existing injected
  `request` seam / MockAgent): `chatCompletions` retries a 429 then
  succeeds; retries twice then rethrows on persistent 503; does NOT retry
  a 401; aborts immediately when `req.signal` fires mid-backoff;
  `chatCompletionsStream` is NOT retried on a 429 (one attempt only).

## Constraints

- Strict TDD RED→GREEN; tests land in the SAME commit as each fix.
- LOCKER lints green. `retry.ts` connection-code strings (`ECONNRESET`
  etc.) are not secrets — LOCKER-03 should pass; if it flags, they are
  detection constants, handle with the proper allowlist treatment, NOT a
  suppression. New exports (`classifyUpstreamStatus`, `parseRetryAfterMs`,
  `LitellmErrorKind`, and anything from `retry.ts`) need non-test importers
  for LOCKER-04 — `errors.ts`/`index.ts` consuming them satisfies this; if
  `retry.ts` helpers are only used inside `index.ts`, that is a valid
  importer. Do NOT export a helper that has no production consumer.
- tsc zero NEW errors. Per-package `tsc --noEmit` in
  `packages/litellm-client` must be 0 (the workspace-root "baseline 5" is
  unrelated config noise — confirmed in A1/A2).
- No `as any` / `@ts-ignore` / `as unknown as` (LOCKER-02).
- Atomic commits — A3 then A4 (two commits) preferred; conventional-commit
  English, each ending with:
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- Do NOT push. Do NOT `--no-verify`. Local `main` only.
- Update `.env.example` / `.env.slim.example` with the three new
  `LITELLM_RETRY_*` knobs (commented, with the default value) if those
  files document the other `LITELLM_*` knobs — check and match the
  existing pattern.
