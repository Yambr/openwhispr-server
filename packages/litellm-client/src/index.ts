// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 Plan 03 Task 1 — shared LiteLLM client factory.
//
// Centralizes the three things every Phase 3 route otherwise has to
// reimplement:
//   1. LITELLM_MASTER_KEY injected into the `authorization: Bearer ...`
//      header so the proxy authenticates us.
//   2. `user: <userId>` body field on chatCompletions (D-03 — per-user
//      attribution via the OpenAI-compatible field; we do NOT mint
//      per-user virtual keys in v1).
//   3. `x-litellm-spend-logs-metadata` header carrying our request_id
//      so OBS-04 can correlate LiteLLM_SpendLogs rows back to our
//      structured log lines.
//
// The Phase 3 hot routes (transcribe / reason) plus the realtime token
// mint consume this client; corporate operators flip LITELLM_BASE_URL to
// their internal proxy and every route follows.
//
// Threat T-03-03-03 (provider-key absence): when the client knows the
// requested model maps to a bundled-default provider whose key is unset,
// we surface MissingProviderKeyError BEFORE the request fires so the
// route returns 503 (not 401). Override mode (LITELLM_BASE_URL set)
// skips the check — corporate proxy owns its own auth posture
// (T-03-03-04 disposition: accept).

import { PassThrough, type Readable } from "node:stream";
import { type Dispatcher, getGlobalDispatcher, request as undiciRequest } from "undici";
import type { LitellmClientConfig, LitellmProviderKeys } from "./config.js";
// Phase 51 / Plan 51-15 — needed at runtime for the
// `config.baseUrl !== DEFAULT_LITELLM_BASE_URL` override-detection
// branch (REVIEW HI-3).
// D2/D6 — `DEFAULT_STT_MODEL` now lives in config.js as the env-default
// for `LITELLM_STT_MODEL`; imported here for the `audioTranscriptions`
// fallback so a caller that omits `model` still gets the bundled alias.
// R32 — the three timeout literals likewise now live in config.js as the
// env-defaults for `LITELLM_HEADERS_TIMEOUT_MS` / `LITELLM_BODY_TIMEOUT_MS`
// / `LITELLM_ERROR_DRAIN_TIMEOUT_MS`. The runtime path reads the resolved
// `config.headersTimeoutMs` / `config.bodyTimeoutMs` / `config.errorDrainTimeoutMs`
// instead of these literals; the constants are re-exported below (see the
// `export { ... } from "./config.js"` block) for back-compat with
// package-internal callers/tests.
import { DEFAULT_LITELLM_BASE_URL, DEFAULT_STT_MODEL } from "./config.js";
import {
  classifyUpstreamStatus,
  type LitellmErrorKind,
  LitellmUpstreamError,
  MissingProviderKeyError,
  parseRetryAfterMs,
  SsrfDispatcherNotInstalledError,
} from "./errors.js";
import { loadBundledModelProviders } from "./model-aliases.js";
import { abortableSleep, computeBackoffMs, isRetryableError } from "./retry.js";

/**
 * Phase 41.f / HI-2 — well-known marker key. The SSRF-wrapping Agent
 * stamps this symbol (non-enumerable) on every instance built by
 * `makeSSRFDispatcher` in apps/api/src/lib/ssrf-dispatcher.ts. We
 * recompute the same registry-keyed symbol here without importing that
 * module (avoids the packages → apps circular dep).
 */
const SSRF_WRAPPED_MARKER = Symbol.for("openwhispr.ssrf-wrapped");

/**
 * Assert the process-wide undici dispatcher is the SSRF-wrapped Agent.
 * Called at first request from each method (not at module load) so that
 * test files that build a client but never fire a request do not need to
 * bootstrap SSRF.
 *
 * When `opts.request` was injected, the assertion is skipped because the
 * injected function owns its own egress path and the global dispatcher is
 * not consulted. The injection seam has TWO sanctioned uses:
 *   1. test mocking (a `MockAgent`-backed `request`); and
 *   2. R24 — production boot-time binding to a `request` that pins the
 *      SSRF-wrapped Agent as the explicit `dispatcher` (see
 *      apps/api/src/lib/litellm-ssrf-request.ts). The injected fn is built
 *      by trusted boot code and is never user-derived, so the
 *      assertion-skip is safe: the fn itself guarantees SSRF-safe egress.
 */
function assertSsrfInstalled(): void {
  // Phase 52 / Plan 52-01 — `exactOptionalPropertyTypes: true` in tsconfig
  // refuses the direct annotation form because Dispatcher's symbol-indexer
  // is `unknown | undefined` (optional). Single `as` (LOCKER-02 clean)
  // narrows the assignment without changing runtime behaviour.
  const dispatcher = getGlobalDispatcher() as Dispatcher & { [k: symbol]: unknown };
  if (!dispatcher[SSRF_WRAPPED_MARKER]) {
    throw new SsrfDispatcherNotInstalledError();
  }
}

/**
 * Phase 41.f / HI-3 — bundled-default model alias → provider-key map,
 * DERIVED from `compose/litellm/litellm_config.yaml` at module load.
 * Closes the drift class flagged in ME-01 / HI-3 of the litellm-client
 * review: any model added to the yaml is automatically picked up by the
 * precheck without a hand-maintained mirror.
 *
 * Override mode (LITELLM_BASE_URL set) intentionally bypasses this map —
 * corporate proxy owns its own provider auth.
 *
 * Fallback: if the yaml is unreadable (e.g. tests running outside the
 * repo checkout), fall back to the four-entry static map preserving the
 * pre-41.f surface. The fallback is intentionally narrow so a fresh
 * clone with a corrupted yaml still surfaces a useful error via the
 * subsequent route 503 rather than crashing module load.
 */
function deriveBundledModelProviderMap(): Record<string, keyof LitellmProviderKeys> {
  try {
    return loadBundledModelProviders() as Record<string, keyof LitellmProviderKeys>;
  } catch {
    // Tests that exercise this fallback live in
    // `tests/unit/model-aliases.test.ts`; the static set below preserves
    // the surface that pre-41.f routes depended on.
    return {
      "qwen3.6-plus": "openrouter",
      "gemini-3-flash": "openrouter",
      "gpt-4o-mini": "openrouter",
      "whisper-large-v3": "groq",
    };
  }
}
/**
 * @internal — Plan 51-15b (REVIEW HIGH HI-4). Module-private constant
 * used by routes within this package; the only external consumers are
 * this package's own tests. NOT a stable public API surface — production
 * callers MUST NOT depend on it; the contract may change without notice.
 */
export const BUNDLED_MODEL_PROVIDER: Record<string, keyof LitellmProviderKeys> =
  deriveBundledModelProviderMap();

/**
 * @internal — Plan 51-15b (REVIEW HIGH HI-4). See BUNDLED_MODEL_PROVIDER.
 */
export const PROVIDER_ENV_VAR: Record<keyof LitellmProviderKeys, string> = {
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  pyannote: "PYANNOTE_API_KEY",
};

/**
 * Phase 41.f / HI-1 — default timeouts for the three non-streaming
 * methods. D-41f-1 picks one pair of conservative defaults that pass both
 * the Phase 8 SLO budget and the 1000-concurrent stall-vector defence.
 *
 * R32 — the timeout posture is now operator-tunable: the canonical
 * default literals live in `config.ts` (the env boundary) as the
 * fallbacks for `LITELLM_HEADERS_TIMEOUT_MS` / `LITELLM_BODY_TIMEOUT_MS`
 * / `LITELLM_ERROR_DRAIN_TIMEOUT_MS`, and the runtime path in
 * `buildLitellmClient` reads the resolved `config.headersTimeoutMs`
 * / `config.bodyTimeoutMs` / `config.errorDrainTimeoutMs`. Callers can
 * still override per-call (transcribe long audio, etc.). The three names
 * below are re-exported from `config.ts` for back-compat with the
 * package's own internal callers/tests.
 */
export {
  /**
   * @internal — Plan 51-15b (REVIEW HIGH HI-4) / R32. Env-default for
   * `LITELLM_BODY_TIMEOUT_MS`; canonical declaration lives in config.ts.
   * Production callers MUST NOT depend on this name.
   */
  DEFAULT_BODY_TIMEOUT_MS,
  /**
   * @internal — Plan 51-06 (REVIEW CR-12) / R32. Env-default for
   * `LITELLM_ERROR_DRAIN_TIMEOUT_MS` — the bound on the non-2xx
   * error-body drain in `chatCompletionsStream`; canonical declaration
   * lives in config.ts. Production callers MUST NOT depend on this name.
   */
  DEFAULT_ERROR_DRAIN_TIMEOUT_MS,
  /**
   * @internal — Plan 51-15b (REVIEW HIGH HI-4) / R32. Env-default for
   * `LITELLM_HEADERS_TIMEOUT_MS`; canonical declaration lives in config.ts.
   * Production callers MUST NOT depend on this name.
   */
  DEFAULT_HEADERS_TIMEOUT_MS,
  /**
   * @internal — litellm-patterns A4. Env-default for
   * `LITELLM_RETRY_BASE_MS`; canonical declaration lives in config.ts.
   * Production callers MUST NOT depend on this name.
   */
  DEFAULT_RETRY_BASE_MS,
  /**
   * @internal — litellm-patterns A4. Env-default for
   * `LITELLM_RETRY_CAP_MS`; canonical declaration lives in config.ts.
   * Production callers MUST NOT depend on this name.
   */
  DEFAULT_RETRY_CAP_MS,
  /**
   * @internal — litellm-patterns A4. Env-default for
   * `LITELLM_RETRY_MAX_ATTEMPTS`; canonical declaration lives in
   * config.ts. Production callers MUST NOT depend on this name.
   */
  DEFAULT_RETRY_MAX_ATTEMPTS,
} from "./config.js";

export interface ChatCompletionRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  userId: string;
  requestId: string;
  /**
   * Upstream #4 — authenticated end-user EMAIL (server-derived from the
   * Better Auth session: `req.user.email`), used for operator-facing
   * attribution. When present it becomes the body `user` field AND, when
   * `config.userHeaderName` is configured, the value of that header.
   * `userId` (the UUID) STAYS `x-litellm-end-user-id` (LiteLLM's stable
   * end-user key + spend-logs anchor — D-1). System/background calls with
   * no authed user omit this → body `user` falls back to the UUID and no
   * email header is emitted (D-3).
   */
  endUser?: string;
  /** Pass-through additional OpenAI chat-completion params (temperature, max_tokens, ...). */
  extras?: Record<string, unknown>;
  /** Phase 41.f / HI-1 — abort signal forwarded to undici. */
  signal?: AbortSignal;
  /** Phase 41.f / HI-1 — undici headersTimeout override; defaults to DEFAULT_HEADERS_TIMEOUT_MS. */
  headersTimeout?: number;
  /** Phase 41.f / HI-1 — undici bodyTimeout override; defaults to DEFAULT_BODY_TIMEOUT_MS. */
  bodyTimeout?: number;
}

/**
 * Phase 08.2 Plan 01 — streaming chat-completions variant.
 *
 * Returns the raw `Dispatcher.ResponseData` so the caller can consume the
 * Node `Readable` body directly (typically bridged to a Web `ReadableStream`
 * via `Readable.toWeb(...)` for SSE → NDJSON translation). MUST be used
 * with the process-wide SSRF dispatcher only — the per-call dispatcher
 * option is intentionally absent from the method surface (T-08.2-01).
 */
export interface ChatCompletionsStreamRequest extends ChatCompletionRequest {
  signal?: AbortSignal;
  /** Optional override; defaults to 0 (no body timeout — long-lived SSE). */
  bodyTimeout?: number;
  /**
   * Phase 41.f / HI-4 — first-class `stream_options` opt-out. Wins over
   * any `extras.stream_options` and over the `include_usage: true`
   * default. Pass `{ include_usage: false }` to drop the per-stream
   * usage chunk (eliminates the small billing-line overhead).
   */
  streamOptions?: Record<string, unknown>;
}

export interface AudioTranscriptionRequest {
  body: Readable;
  contentType: string;
  userId: string;
  requestId: string;
  /**
   * Upstream #4 — authenticated end-user EMAIL for operator attribution.
   * The multipart `/v1/audio/transcriptions` body has no JSON `user` slot,
   * so the configurable `config.userHeaderName` header is this method's
   * ONLY attribution vector. `x-litellm-end-user-id` stays the UUID (D-1).
   */
  endUser?: string;
  /**
   * Phase 19.2 / Plan 02 — SERVER-ERRORS Entry 11 closure.
   *
   * LiteLLM Proxy's `/v1/audio/transcriptions` rejects requests with
   * `model=None` (HTTP 400 "Invalid model name passed in model=None").
   * Since the underlying OpenAI-compatible multipart endpoint has no
   * JSON body slot to inject model, we forward it as a URL query-string
   * param (the proxy honors both query and multipart-form variants;
   * query is simpler and preserves the streaming body invariant).
   *
   * Defaults to `whisper-large-v3` (the bundled-default Groq alias in
   * `compose/litellm/litellm_config.yaml`). Corporate operators
   * override via the route's STT_MODEL constant or an env knob;
   * `checkProviderKey` continues to gate on the same default alias.
   */
  model?: string;
  /** Phase 41.f / HI-1 — abort signal forwarded to undici. */
  signal?: AbortSignal;
  /** Phase 41.f / HI-1 — undici headersTimeout override. */
  headersTimeout?: number;
  /** Phase 41.f / HI-1 — undici bodyTimeout override. */
  bodyTimeout?: number;
}

export interface PassthroughRequest {
  method: string;
  body?: Readable | string | Buffer;
  contentType?: string;
  userId: string;
  requestId: string;
  /**
   * Upstream #4 — authenticated end-user EMAIL for operator attribution.
   * The passthrough body is opaque (no JSON `user` slot), so the
   * configurable `config.userHeaderName` header is this method's ONLY
   * attribution vector. `x-litellm-end-user-id` stays the UUID (D-1).
   */
  endUser?: string;
  /** Phase 41.f / HI-1 — abort signal forwarded to undici. */
  signal?: AbortSignal;
  /** Phase 41.f / HI-1 — undici headersTimeout override. */
  headersTimeout?: number;
  /** Phase 41.f / HI-1 — undici bodyTimeout override. */
  bodyTimeout?: number;
}

export interface LitellmClient {
  // Phase 52 / Plan 52-01 — undici 7.x default-changed
  // `Dispatcher.ResponseData` from `ResponseData<any>` to
  // `ResponseData<null>`. `undiciRequest()` returns `ResponseData<unknown>`,
  // so each return type is pinned explicitly to `<unknown>` to match the
  // runtime shape (the body is a `Readable`, not parsed JSON; opaque to
  // the client).
  chatCompletions(req: ChatCompletionRequest): Promise<Dispatcher.ResponseData<unknown>>;
  chatCompletionsStream(
    req: ChatCompletionsStreamRequest,
  ): Promise<Dispatcher.ResponseData<unknown>>;
  audioTranscriptions(args: AudioTranscriptionRequest): Promise<Dispatcher.ResponseData<unknown>>;
  passthrough(path: string, args: PassthroughRequest): Promise<Dispatcher.ResponseData<unknown>>;
  /** Test seam: lets routes derive ws:// URLs from baseUrl for Plan 06 wsUpstream. */
  readonly baseUrl: string;
}

export interface BuildLitellmClientOptions {
  /**
   * When `true`, the client treats LITELLM_BASE_URL as a corporate
   * override and skips bundled-default provider-key pre-checks. Defaults
   * to detection from the same env: `!!env.LITELLM_BASE_URL`.
   * Tests inject this explicitly so they don't depend on process.env.
   */
  isOverride?: boolean;
  /**
   * Optional injection point for the outbound `request` function. Defaults
   * to undici's global `request` (which honors
   * `setGlobalDispatcher(new MockAgent(...))`). Two sanctioned uses:
   *   1. test mocking; and
   *   2. R24 — production boot-time binding to a `request` that pins an
   *      explicit SSRF-wrapped dispatcher, so the client never depends on
   *      the mutable process-global dispatcher surviving boot.
   * In BOTH cases `assertSsrfInstalled` is skipped because the injected
   * function owns its own SSRF-safe egress path. The default (no-injection)
   * path still runs `ssrfGate()` to protect any future bare caller.
   */
  request?: typeof undiciRequest;
}

/**
 * Phase 19.2 / Plan 02 — SERVER-ERRORS Entry 11. Extracts the `boundary`
 * token from a `multipart/form-data` content-type header. Returns `null`
 * when the header is not multipart or has no boundary attribute (we then
 * skip the prefix-injection branch — query-param fallback still applies).
 */
function parseMultipartBoundary(contentType: string): string | null {
  if (!contentType.toLowerCase().includes("multipart/form-data")) return null;
  // CodeQL #19 (js/polynomial-redos) — the prior `/boundary=("?)([^";]+)\1/i`
  // pairs an optional capture group with a backreference; on a long
  // `boundary=` run with no closing quote the engine backtracks
  // super-linearly. Replace the backreference with an explicit
  // two-branch alternation (quoted vs. unquoted), each branch a single
  // bounded charclass run — linear-time, no backtracking ambiguity.
  // Branch 1 matches a balanced-quoted value, branch 2 the bare token;
  // both require >=1 inner char, exactly as the prior pattern did.
  const match = contentType.match(/boundary="([^"]+)"|boundary=([^";]+)/i);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

/**
 * Phase 51 / Plan 51-06 (REVIEW CR-12) — drain an undici response body
 * under a hard timeout. The 2xx path keeps `bodyTimeout: 0` (long-lived
 * SSE), so on the non-2xx error path we cannot rely on undici to bound
 * `res.body.text()`. The returned string carries
 * `"<drain-timeout-after-Nms>"` on timeout so the LitellmUpstreamError
 * surfaces the operator-visible marker.
 *
 * AUDIT-LIB-03 (LIB-4) — the timer is the Node 24 builtin
 * `AbortSignal.timeout(ms)` rather than a hand-rolled
 * setTimeout/clearTimeout/unref trio. undici's `BodyReadable.text()`
 * takes no `signal` argument, so the abort path is wired by listening
 * for the signal's `abort` event and destroying the body there; the
 * drain is raced against an abort-resolved promise. The builtin timer
 * is internally unref'd (process exit is not held open) and needs no
 * explicit clear.
 *
 * Inputs:
 *   * `body` — anything with `text(): Promise<string>` + an optional
 *     `destroy()` (undici response body and Node Readable both qualify).
 *   * `timeoutMs` — finite positive bound.
 *
 * Output: the upstream body text, OR the timeout marker.
 */
async function drainWithTimeout(
  body: { text(): Promise<string>; destroy?(err?: Error): void },
  timeoutMs: number,
): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);
  const timeoutPromise = new Promise<string>((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        try {
          body.destroy?.(new Error(`drain-timeout-after-${timeoutMs}ms`));
        } catch {
          /* best-effort: stream may already be settled */
        }
        resolve(`<drain-timeout-after-${timeoutMs}ms>`);
      },
      { once: true },
    );
  });
  return Promise.race([body.text(), timeoutPromise]);
}

/**
 * litellm-patterns A3 — build the {@link LitellmUpstreamError} options
 * object at a non-2xx throw site: classify the status and parse the
 * upstream `Retry-After`. `retryAfterMs` is added ONLY when present so the
 * optional field stays genuinely absent under `exactOptionalPropertyTypes`.
 */
function upstreamErrorOptions(
  status: number,
  retryAfterHeader: string | string[] | undefined,
): { kind: LitellmErrorKind; retryAfterMs?: number } {
  const kind = classifyUpstreamStatus(status);
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader, Date.now());
  return retryAfterMs === undefined ? { kind } : { kind, retryAfterMs };
}

export function buildLitellmClient(
  config: LitellmClientConfig,
  opts: BuildLitellmClientOptions = {},
): LitellmClient {
  // Phase 51 / Plan 51-15 (REVIEW HIGH) — derive `isOverride` from the
  // ACTUAL `config.baseUrl` (vs the default), not from `process.env`.
  // Pre-fix the two sources could disagree (dotenv timing, test
  // injection, future worker), producing spurious MissingProviderKeyError
  // → 503 in corporate deployments. The env-based path is still honored
  // as the FALLBACK when the caller does not explicitly pass `isOverride`
  // AND `config.baseUrl` equals the default.
  const isOverride =
    opts.isOverride ??
    (config.baseUrl !== DEFAULT_LITELLM_BASE_URL || Boolean(process.env.LITELLM_BASE_URL));
  // Phase 41.f / HI-2 — when no test-injected `request` is supplied we are
  // going through undici's global dispatcher; assert it carries the SSRF
  // marker before any outbound bytes leave the process.
  const usingGlobalDispatcher = opts.request === undefined;
  const doRequest = opts.request ?? undiciRequest;
  function ssrfGate(): void {
    if (usingGlobalDispatcher) assertSsrfInstalled();
  }

  function checkProviderKey(model: string): void {
    // Corporate proxy owns its own auth (T-03-03-04 disposition: accept).
    if (isOverride) return;
    const provider = BUNDLED_MODEL_PROVIDER[model];
    if (!provider) return; // unknown model: defer to upstream for canonical 4xx
    if (!config.providerKeys[provider]) {
      throw new MissingProviderKeyError(PROVIDER_ENV_VAR[provider], model);
    }
  }

  function authHeaders(
    userId: string,
    requestId: string,
    endUser?: string,
  ): Record<string, string> {
    // Phase 51 / Plan 51-15 (REVIEW HIGH) — defence-in-depth CR/LF
    // rejection on caller-supplied header values. Production callsites
    // (apps/api routes) source these from `req.user.id` (UUID) and
    // `req.id` (ulid), so a CR/LF cannot reach this point through
    // normal flow — but a misimplementation of a future route would
    // produce undici-internal errors with confusing 500 envelopes
    // rather than a clean rejection here.
    if (/[\r\n]/.test(userId)) {
      throw new Error("litellm-client: userId must not contain CR/LF");
    }
    if (/[\r\n]/.test(requestId)) {
      throw new Error("litellm-client: requestId must not contain CR/LF");
    }
    // Upstream #4 (T-oc4-02) — `endUser` is server-derived from the Better
    // Auth session (`req.user.email`), never client-asserted, but we apply
    // the same CR/LF belt as userId/requestId: it flows into an outbound
    // header value when `config.userHeaderName` is configured.
    if (endUser !== undefined && /[\r\n]/.test(endUser)) {
      throw new Error("litellm-client: endUser must not contain CR/LF");
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${config.masterKey}`,
      // D-1 — `x-litellm-end-user-id` STAYS the stable UUID (LiteLLM's
      // end-user key + spend-logs anchor); emails are mutable.
      "x-litellm-end-user-id": userId,
      "x-litellm-spend-logs-metadata": JSON.stringify({
        openwhispr_request_id: requestId,
      }),
    };
    // Upstream #4 / D-2 — emit the operator-configured email header ONLY
    // when BOTH the name is configured AND an endUser email is present.
    // Opt-in (D-3): no header name → no email header regardless of endUser.
    if (config.userHeaderName !== undefined && endUser !== undefined) {
      headers[config.userHeaderName] = endUser;
    }
    return headers;
  }

  async function ensureOk(
    res: Dispatcher.ResponseData<unknown>,
  ): Promise<Dispatcher.ResponseData<unknown>> {
    if (res.statusCode >= 400) {
      const bodyText = await res.body.text();
      // litellm-patterns A3 — classify the status and parse the upstream
      // `Retry-After` header so callers (the A4 retry layer) can branch on
      // `err.kind` / `err.retryAfterMs` without re-deriving status ranges.
      throw new LitellmUpstreamError(
        res.statusCode,
        bodyText,
        upstreamErrorOptions(res.statusCode, res.headers["retry-after"]),
      );
    }
    return res;
  }

  return {
    baseUrl: config.baseUrl,

    async chatCompletions(req) {
      ssrfGate();
      const model = req.model ?? config.defaultChatModel;
      checkProviderKey(model);
      const body = JSON.stringify({
        ...req.extras,
        model,
        messages: req.messages,
        // D-03 / upstream #4 (D-2): per-user attribution via the
        // OpenAI-compatible `user` field. Prefer the end-user EMAIL when
        // present; fall back to the UUID for system/background calls.
        user: req.endUser ?? req.userId,
      });
      // litellm-patterns A4 — retry loop wrapping ONLY chatCompletions.
      // chatCompletionsStream MUST NOT be retried (a partially-consumed
      // SSE body cannot be safely replayed) — enforced by construction:
      // the stream method below simply never calls this loop.
      // audioTranscriptions is excluded in v1 — its body is a single-use
      // Readable (a future phase can buffer-and-retry).
      //
      // Each attempt re-issues the request fresh; the JSON body is a
      // pre-stringified string so there is no single-use-body problem
      // here. Per-attempt headersTimeout / bodyTimeout still apply (the
      // retry budget is NOT a global deadline).
      const maxAttempts = Math.max(1, config.retryMaxAttempts);
      let lastErr: unknown;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          // Phase 41.f / HI-1 — forward headersTimeout / bodyTimeout / signal.
          // R32 — the defaults come from `config` (env-tunable) rather than
          // a hardcoded literal; an explicit per-call override still wins.
          const reqOpts: Record<string, unknown> = {
            method: "POST",
            headers: {
              ...authHeaders(req.userId, req.requestId, req.endUser),
              "content-type": "application/json",
            },
            body,
            headersTimeout: req.headersTimeout ?? config.headersTimeoutMs,
            bodyTimeout: req.bodyTimeout ?? config.bodyTimeoutMs,
          };
          if (req.signal) reqOpts.signal = req.signal;
          const res = await doRequest(
            `${config.baseUrl}/v1/chat/completions`,
            reqOpts as Parameters<typeof doRequest>[1],
          );
          return await ensureOk(res);
        } catch (err) {
          lastErr = err;
          // Not retryable — rethrow now (auth / client / unknown).
          if (!isRetryableError(err)) throw err;
          // Retryable but the budget is exhausted on the last attempt.
          if (attempt + 1 >= maxAttempts) throw err;
          // Caller cancelled — rethrow immediately, do NOT sleep.
          if (req.signal?.aborted) throw err;
          const retryAfterMs = err instanceof LitellmUpstreamError ? err.retryAfterMs : undefined;
          const delayMs = computeBackoffMs(
            attempt,
            retryAfterMs,
            config.retryBaseMs,
            config.retryCapMs,
          );
          await abortableSleep(delayMs, req.signal);
          // If the signal fired while we slept, rethrow the upstream error
          // immediately rather than spinning another attempt.
          if (req.signal?.aborted) throw err;
        }
      }
      // Unreachable — the loop either returns a success or rethrows the
      // last error. `throw lastErr` here is the type-narrowing belt.
      throw lastErr;
    },

    async chatCompletionsStream(req) {
      ssrfGate();
      // Phase 08.2 Plan 01: streaming variant for /api/agent/stream.
      // Returns raw Dispatcher.ResponseData (Node Readable body) — caller
      // must NOT see this method pre-consume the body on 2xx.
      const model = req.model ?? config.defaultChatModel;
      checkProviderKey(model);
      // Phase 41.f / HI-4 — merge order (later wins):
      //   1. default `{ include_usage: true }`
      //   2. `extras.stream_options` (legacy surface)
      //   3. explicit `streamOptions` param (first-class, can opt OUT)
      // Stripped from extras spread to avoid the literal-overwrite trap.
      const extrasStreamOptions =
        (req.extras as { stream_options?: Record<string, unknown> } | undefined)?.stream_options ??
        {};
      const mergedStreamOptions: Record<string, unknown> = {
        include_usage: true,
        ...extrasStreamOptions,
        ...(req.streamOptions ?? {}),
      };
      const body = JSON.stringify({
        ...req.extras,
        model,
        messages: req.messages,
        // D-03 / upstream #4 (D-2) — prefer the end-user EMAIL, fall back
        // to the UUID for system/background calls.
        user: req.endUser ?? req.userId,
        stream: true,
        stream_options: mergedStreamOptions,
      });
      // T-08.2-01: NO per-call dispatcher option — rely on the process-wide
      // SSRF agent set via setGlobalDispatcher. Forward signal + bodyTimeout.
      // Default bodyTimeout: 0 (no body-read timeout — long-lived SSE).
      const requestOpts: Record<string, unknown> = {
        method: "POST",
        headers: {
          ...authHeaders(req.userId, req.requestId, req.endUser),
          "content-type": "application/json",
        },
        body,
        bodyTimeout: req.bodyTimeout ?? 0,
      };
      if (req.signal) requestOpts.signal = req.signal;
      const res = await doRequest(
        `${config.baseUrl}/v1/chat/completions`,
        requestOpts as Parameters<typeof doRequest>[1],
      );
      // Inline non-2xx → LitellmUpstreamError mapping. We do NOT call
      // ensureOk because we MUST NOT touch res.body on the 2xx path (the
      // caller streams it). On non-2xx we drain body.text() ONCE under a
      // bound (Phase 51 / Plan 51-06 / REVIEW CR-12) — a slow-rolled
      // upstream error body would otherwise hang the handler forever
      // because `bodyTimeout: 0` is the 2xx-path default. The bound is
      // `config.errorDrainTimeoutMs` (R32 — env-tunable via
      // `LITELLM_ERROR_DRAIN_TIMEOUT_MS`); on timeout we discard whatever
      // bytes arrived and surface the upstream error envelope with an
      // explicit "drain-timeout" marker so operators can disambiguate
      // upstream-broken from upstream-slow in logs.
      if (res.statusCode >= 400) {
        const bodyText = await drainWithTimeout(res.body, config.errorDrainTimeoutMs);
        // litellm-patterns A3 — same classification as `ensureOk` so a
        // streaming caller also sees `err.kind` / `err.retryAfterMs`.
        throw new LitellmUpstreamError(
          res.statusCode,
          bodyText,
          upstreamErrorOptions(res.statusCode, res.headers["retry-after"]),
        );
      }
      return res;
    },

    async audioTranscriptions(args) {
      ssrfGate();
      // Phase 19.2 / Plan 02 — SERVER-ERRORS Entry 11 closure: forward
      // the model into LiteLLM's /v1/audio/transcriptions. LiteLLM
      // proxy v1.83.x reads `model` ONLY from the multipart form data
      // (`form_data = await get_form_data(request)` →
      // `data.get("model", None)` at proxy_server.py:8076); the query
      // string is ignored and `model=None` triggers
      // `Invalid model name passed in model=None` (HTTP 400). We
      // therefore:
      //   (a) belt-and-braces append `?model=...` to the URL for
      //       forward-compat / alt LiteLLM forks that DO honor query;
      //   (b) prepend a synthetic multipart part `name="model"` to the
      //       request body — the multipart parser accepts fields in
      //       any order and the file part still comes through intact.
      // Streaming invariant preserved: we wrap the original Readable
      // in a PassThrough and write the prefix bytes before piping the
      // caller's body. No buffering of the audio payload.
      const model = args.model ?? DEFAULT_STT_MODEL;
      checkProviderKey(model);

      const boundary = parseMultipartBoundary(args.contentType);
      let body: Readable = args.body;
      if (boundary) {
        const prefix = Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="model"\r\n\r\n` +
            `${model}\r\n`,
          "utf8",
        );
        const through = new PassThrough();
        through.write(prefix);
        args.body.on("error", (err) => through.destroy(err));
        // Phase 51 / Plan 51-15 (REVIEW HIGH) — bidirectional teardown.
        // Pre-fix only the source->destination error direction was
        // wired. If undici aborted mid-upload, the source Readable
        // kept reading from disk/socket until GC, producing an fd /
        // memory leak per failed upload. Forward destination close +
        // error to the source so the file descriptor (or socket) is
        // released immediately.
        const destroySource = (err?: Error): void => {
          if (!args.body.destroyed) args.body.destroy(err);
        };
        through.on("close", () => destroySource());
        through.on("error", (err) => destroySource(err));
        args.body.pipe(through);
        body = through;
      }

      const url = `${config.baseUrl}/v1/audio/transcriptions?model=${encodeURIComponent(model)}`;
      const reqOpts: Record<string, unknown> = {
        method: "POST",
        headers: {
          ...authHeaders(args.userId, args.requestId, args.endUser),
          "content-type": args.contentType,
        },
        body,
        // R32 — env-tunable defaults; per-call override still wins.
        headersTimeout: args.headersTimeout ?? config.headersTimeoutMs,
        bodyTimeout: args.bodyTimeout ?? config.bodyTimeoutMs,
      };
      if (args.signal) reqOpts.signal = args.signal;
      const res = await doRequest(url, reqOpts as Parameters<typeof doRequest>[1]);
      return ensureOk(res);
    },

    async passthrough(path, args) {
      ssrfGate();
      const headers: Record<string, string> = authHeaders(
        args.userId,
        args.requestId,
        args.endUser,
      );
      if (args.contentType) headers["content-type"] = args.contentType;
      // Phase 41.f / HI-1 — forward headersTimeout / bodyTimeout / signal.
      // R32 — env-tunable defaults; per-call override still wins.
      const reqOpts: Record<string, unknown> = {
        method: args.method as Dispatcher.HttpMethod,
        headers,
        headersTimeout: args.headersTimeout ?? config.headersTimeoutMs,
        bodyTimeout: args.bodyTimeout ?? config.bodyTimeoutMs,
      };
      if (args.body !== undefined) reqOpts.body = args.body;
      if (args.signal) reqOpts.signal = args.signal;
      const res = await doRequest(
        `${config.baseUrl}${path}`,
        reqOpts as Parameters<typeof doRequest>[1],
      );
      return ensureOk(res);
    },
  };
}

export type {
  LitellmClientConfig,
  LitellmProviderKeys,
} from "./config.js";
export {
  DEFAULT_CHAT_MODEL,
  DEFAULT_CLEANUP_MODEL,
  DEFAULT_LITELLM_BASE_URL,
  DEFAULT_REALTIME_MODEL,
  DEFAULT_STT_MODEL,
  loadLitellmConfigFromEnv,
} from "./config.js";
export type { ParsePositiveNumberEnvOptions } from "./env-parse.js";
export {
  parsePositiveIntEnv,
  parsePositiveNumberEnv,
} from "./env-parse.js";
// litellm-patterns A3 — `classifyUpstreamStatus` / `parseRetryAfterMs` /
// `LitellmUpstreamErrorOptions` / `LitellmErrorKind` are package-internal
// (consumed by the `index.ts` throw sites + the `LitellmUpstreamError.kind`
// field in `errors.ts`) and are intentionally NOT re-exported from the
// package entrypoint — re-exporting a symbol with no cross-package
// production consumer creates a LOCKER-04 dead export. A future apps/api
// consumer that needs `LitellmErrorKind` re-adds the re-export here.
export {
  LitellmUpstreamError,
  MissingProviderKeyError,
  SsrfDispatcherNotInstalledError,
} from "./errors.js";
export {
  getDefaultAgentModel,
  loadBundledModelProviders,
  loadLitellmModelAliases,
} from "./model-aliases.js";
// litellm-patterns A2 — re-exported for package consumers; the non-test
// importer keeping it off the LOCKER-04 dead-export list is `errors.ts`.
export { redactSecretShapes } from "./redact.js";
