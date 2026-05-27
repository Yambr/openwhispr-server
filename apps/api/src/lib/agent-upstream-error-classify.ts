// SPDX-License-Identifier: FSL-1.1-ALv2
// 260528-0cm — Agent stream upstream error classifier.
//
// Pure helper: maps an arbitrary thrown value (LitellmUpstreamError /
// AbortError / undici dispatcher error code / plain Error / null /
// undefined / non-Error) to a typed `ClassifiedAgentError` carrying the
// canonical English `error` string, the `AgentErrorCode` discriminant,
// the raw upstream HTTP status (LiteLLM cases only), the redacted +
// truncated upstream body (≤500 chars), and the LiteLLM `kind`
// passthrough.
//
// Wire contract:
//   - `error` is read directly into the NDJSON `chunk.error` field by
//     `apps/api/src/routes/agent/stream.ts`. It MUST be a safe,
//     credential-shape-free, English literal (see D3 in
//     `.planning/quick/260528-0cm-agent-stream-error-contract/CONTEXT.md`).
//   - `upstreamBody` flows ONLY to `req.log.error` (Loki). The route
//     code does NOT serialize it onto the wire.
//   - `provider:"litellm"|"unknown"` is encoded by the route call site,
//     not this helper (D2 lock).
//
// Security:
//   - Every body-source extraction goes through
//     `redactSecretShapes(...).slice(0, 500)` (LOCKER-05 belt-and-braces;
//     `LitellmUpstreamError.message` is already 200-char truncated +
//     redacted at construction, we re-redact + re-slice defensively).
//   - LOCKER-01 clean: helper does not branch on the runtime mode env.
//   - LOCKER-02 clean: no type-suppression escape hatches present.
//   - LOCKER-03 clean: no hostname / UUID / credential-shape literals.
//   - LOCKER-04 clean: every exported symbol is consumed by
//     `apps/api/src/routes/agent/stream.ts` (route catches) and
//     `apps/api/src/lib/sse-parser.ts` (type-only import for the
//     `StreamChunk` union). `CANONICAL_ERROR_MESSAGES` is NOT exported.

import { LitellmUpstreamError, redactSecretShapes } from "@openwhispr/litellm-client";

/**
 * 6-member union per CONTEXT.md D3 + RESEARCH.md R11. Each value maps 1:1
 * to a canonical English message in `CANONICAL_ERROR_MESSAGES` below.
 * Order matches the operator-runbook table in `docs/operations.md`.
 */
export type AgentErrorCode =
  | "upstream_auth"
  | "upstream_rate_limit"
  | "upstream_quota_exceeded"
  | "upstream_invalid_model"
  | "upstream_timeout"
  | "upstream_unknown";

/**
 * Result of classifying an upstream failure.
 *
 * - `code` discriminates the wire envelope's `chunk.code` field.
 * - `error` is the canonical English message safe for the wire (no
 *   credential shapes, no raw upstream body fragments).
 * - `upstreamStatus` is the LiteLLM HTTP status (LitellmUpstreamError
 *   path) or `null` for network/abort/non-Error throws.
 * - `upstreamBody` is the redacted + truncated upstream payload (≤500
 *   chars) used for operator observability via `req.log.error` — NEVER
 *   serialized onto the wire by the route handler.
 * - `kind` is the LiteLLM `LitellmErrorKind` passthrough on the
 *   LitellmUpstreamError branch; `null` otherwise.
 */
export interface ClassifiedAgentError {
  code: AgentErrorCode;
  error: string;
  upstreamStatus: number | null;
  upstreamBody: string | null;
  kind: string | null;
}

/**
 * Maximum length of `upstreamBody` after redaction + truncation. Matches
 * the per-field budget agreed in CONTEXT.md D3 (500 chars — 2.5× the
 * 200-char ceiling the `LitellmUpstreamError` constructor applies; the
 * extra headroom accommodates legitimately verbose upstream JSON error
 * envelopes after redaction).
 */
const UPSTREAM_BODY_MAX_LEN = 500;

/**
 * Internal canonical messages — NOT exported (LOCKER-04 hygiene: no
 * cross-package consumer exists). Tests assert against literal mirrors;
 * any drift between this map and the test fixtures is a real contract
 * regression and fails the RED tests.
 *
 * `satisfies Record<AgentErrorCode, string>` provides compile-time
 * exhaustiveness — adding a new code without a message is a type error.
 */
const CANONICAL_ERROR_MESSAGES = Object.freeze({
  upstream_auth:
    "Upstream model provider rejected the request (authentication failure). Contact your operator.",
  upstream_rate_limit: "Rate limit reached. Please retry in a few seconds.",
  upstream_quota_exceeded: "Upstream provider quota exceeded. Contact your operator.",
  upstream_invalid_model:
    "Requested model is not available on this server. Choose a different model or contact your operator.",
  upstream_timeout: "Upstream provider did not respond in time. Please retry.",
  upstream_unknown: "Upstream model provider is temporarily unavailable. Please try again.",
} as const) satisfies Record<AgentErrorCode, string>;

/**
 * Undici dispatcher error codes + Node net error codes that we treat as
 * timeout-class failures (D2/D3 lock: ECONNREFUSED/ECONNRESET/ETIMEDOUT/
 * ENOTFOUND/EAI_AGAIN map to `upstream_timeout` per the user prompt
 * scope, NOT `upstream_unknown` — the user prompt is the locked
 * authority overriding RESEARCH.md R4's narrower reading).
 */
const TIMEOUT_ERROR_CODES = new Set<string>([
  "UND_ERR_ABORTED",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

/**
 * 400-status body regex selecting `upstream_invalid_model`. Per audit
 * §5.2's literal regex (RESEARCH.md R3 keeps it as-is; status-first
 * narrowing limits false-positive blast radius to 400s only).
 */
const MODEL_NOT_FOUND_400_REGEX = /invalid model name|model_not_found|not.found/i;

function redactAndCap(raw: string): string {
  return redactSecretShapes(raw).slice(0, UPSTREAM_BODY_MAX_LEN);
}

/**
 * Map a thrown value to its `ClassifiedAgentError` envelope. Total
 * function — never throws, never returns `undefined`.
 *
 * Branching priority:
 *   1. `LitellmUpstreamError` (status + kind + message + retryAfterMs)
 *   2. Network / abort errors (AbortError or undici/Node net code)
 *   3. Catch-all (plain Error / null / undefined / non-Error throws)
 */
export function classifyUpstreamError(err: unknown): ClassifiedAgentError {
  // Branch 1 — LiteLLM upstream HTTP non-2xx.
  if (err instanceof LitellmUpstreamError) {
    const status = err.status;
    const upstreamBody = redactAndCap(err.message);
    const kind = err.kind;

    let code: AgentErrorCode;
    if (kind === "auth" || status === 401 || status === 403) {
      code = "upstream_auth";
    } else if (status === 402) {
      code = "upstream_quota_exceeded";
    } else if (status === 429) {
      code = "upstream_rate_limit";
    } else if (status === 404) {
      code = "upstream_invalid_model";
    } else if (status === 400 && MODEL_NOT_FOUND_400_REGEX.test(upstreamBody)) {
      code = "upstream_invalid_model";
    } else if (status >= 500) {
      code = "upstream_unknown";
    } else {
      code = "upstream_unknown";
    }

    let error: string = CANONICAL_ERROR_MESSAGES[code];
    if (code === "upstream_rate_limit") {
      const retryAfterMs = err.retryAfterMs;
      if (retryAfterMs !== undefined && retryAfterMs > 0) {
        const seconds = Math.ceil(retryAfterMs / 1000);
        error = `${CANONICAL_ERROR_MESSAGES.upstream_rate_limit} (retry in ~${String(seconds)}s)`;
      }
    }

    return {
      code,
      error,
      upstreamStatus: status,
      upstreamBody,
      kind,
    };
  }

  // Branch 2 — network / abort / undici dispatcher error.
  const e = err as { name?: unknown; code?: unknown; message?: unknown };
  const errName = typeof e?.name === "string" ? e.name : undefined;
  const errCode = typeof e?.code === "string" ? e.code : undefined;
  const errMessage = typeof e?.message === "string" ? e.message : undefined;

  if (errName === "AbortError" || (errCode !== undefined && TIMEOUT_ERROR_CODES.has(errCode))) {
    const upstreamBody = errMessage !== undefined ? redactAndCap(errMessage) || null : null;
    return {
      code: "upstream_timeout",
      error: CANONICAL_ERROR_MESSAGES.upstream_timeout,
      upstreamStatus: null,
      upstreamBody,
      kind: null,
    };
  }

  // Branch 3 — catch-all (plain Error, TypeError, null, undefined,
  // string throw, plain object throw). Per CONTEXT.md D3: if a
  // `.message` field is present we capture (redacted + capped) it for
  // observability; otherwise upstreamBody is null.
  const upstreamBody = errMessage !== undefined ? redactAndCap(errMessage) || null : null;
  return {
    code: "upstream_unknown",
    error: CANONICAL_ERROR_MESSAGES.upstream_unknown,
    upstreamStatus: null,
    upstreamBody,
    kind: null,
  };
}
