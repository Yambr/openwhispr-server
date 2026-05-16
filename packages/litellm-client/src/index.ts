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
// All three Phase 3 hot routes (transcribe / reason / diarization) plus
// the realtime token mint consume this client; corporate operators flip
// LITELLM_BASE_URL to their internal proxy and every route follows.
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
import {
  LitellmUpstreamError,
  MissingProviderKeyError,
  SsrfDispatcherNotInstalledError,
} from "./errors.js";

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
 * When `opts.request` was injected (test seam), the assertion is skipped
 * because the injected function owns its own network mocking and the
 * global dispatcher is not consulted.
 */
function assertSsrfInstalled(): void {
  const dispatcher: Dispatcher & { [k: symbol]: unknown } = getGlobalDispatcher();
  if (!dispatcher[SSRF_WRAPPED_MARKER]) {
    throw new SsrfDispatcherNotInstalledError();
  }
}

/**
 * Static map of bundled-default model alias -> provider-key env var.
 * Mirrors compose/litellm/litellm_config.yaml `model_list`. When the
 * operator overrides LITELLM_BASE_URL to a corporate proxy this map is
 * intentionally bypassed (corporate proxy owns its own provider auth).
 */
export const BUNDLED_MODEL_PROVIDER: Record<string, keyof LitellmProviderKeys> = {
  "qwen3.6-plus": "openrouter",
  "gemini-3-flash": "openrouter",
  "gpt-4o-mini": "openrouter",
  "whisper-large-v3": "groq",
};

export const PROVIDER_ENV_VAR: Record<keyof LitellmProviderKeys, string> = {
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  pyannote: "PYANNOTE_API_KEY",
};

/**
 * Phase 41.f / HI-1 — default timeouts for the three non-streaming
 * methods. D-41f-1 picks one pair of conservative defaults that pass both
 * the Phase 8 SLO budget and the 1000-concurrent stall-vector defence.
 * Callers can override per-call (transcribe long audio, etc.).
 */
export const DEFAULT_HEADERS_TIMEOUT_MS = 30_000;
export const DEFAULT_BODY_TIMEOUT_MS = 120_000;

export interface ChatCompletionRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  userId: string;
  requestId: string;
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
}

export interface AudioTranscriptionRequest {
  body: Readable;
  contentType: string;
  userId: string;
  requestId: string;
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

export const DEFAULT_STT_MODEL = "whisper-large-v3";

export interface PassthroughRequest {
  method: string;
  body?: Readable | string | Buffer;
  contentType?: string;
  userId: string;
  requestId: string;
  /** Phase 41.f / HI-1 — abort signal forwarded to undici. */
  signal?: AbortSignal;
  /** Phase 41.f / HI-1 — undici headersTimeout override. */
  headersTimeout?: number;
  /** Phase 41.f / HI-1 — undici bodyTimeout override. */
  bodyTimeout?: number;
}

export interface LitellmClient {
  chatCompletions(req: ChatCompletionRequest): Promise<Dispatcher.ResponseData>;
  chatCompletionsStream(req: ChatCompletionsStreamRequest): Promise<Dispatcher.ResponseData>;
  audioTranscriptions(args: AudioTranscriptionRequest): Promise<Dispatcher.ResponseData>;
  passthrough(path: string, args: PassthroughRequest): Promise<Dispatcher.ResponseData>;
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
   * Optional injection point for tests. Defaults to undici's global
   * `request` (which honors `setGlobalDispatcher(new MockAgent(...))`).
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
  const match = contentType.match(/boundary=("?)([^";]+)\1/i);
  return match ? (match[2] ?? null) : null;
}

export function buildLitellmClient(
  config: LitellmClientConfig,
  opts: BuildLitellmClientOptions = {},
): LitellmClient {
  const isOverride = opts.isOverride ?? Boolean(process.env.LITELLM_BASE_URL);
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

  function authHeaders(userId: string, requestId: string): Record<string, string> {
    return {
      authorization: `Bearer ${config.masterKey}`,
      "x-litellm-end-user-id": userId,
      "x-litellm-spend-logs-metadata": JSON.stringify({
        openwhispr_request_id: requestId,
      }),
    };
  }

  async function ensureOk(res: Dispatcher.ResponseData): Promise<Dispatcher.ResponseData> {
    if (res.statusCode >= 400) {
      const bodyText = await res.body.text();
      throw new LitellmUpstreamError(res.statusCode, bodyText);
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
        user: req.userId, // D-03: per-user attribution via OpenAI-compatible field
      });
      // Phase 41.f / HI-1 — forward headersTimeout / bodyTimeout / signal.
      const reqOpts: Record<string, unknown> = {
        method: "POST",
        headers: {
          ...authHeaders(req.userId, req.requestId),
          "content-type": "application/json",
        },
        body,
        headersTimeout: req.headersTimeout ?? DEFAULT_HEADERS_TIMEOUT_MS,
        bodyTimeout: req.bodyTimeout ?? DEFAULT_BODY_TIMEOUT_MS,
      };
      if (req.signal) reqOpts.signal = req.signal;
      const res = await doRequest(
        `${config.baseUrl}/v1/chat/completions`,
        reqOpts as Parameters<typeof doRequest>[1],
      );
      return ensureOk(res);
    },

    async chatCompletionsStream(req) {
      ssrfGate();
      // Phase 08.2 Plan 01: streaming variant for /api/agent/stream.
      // Returns raw Dispatcher.ResponseData (Node Readable body) — caller
      // must NOT see this method pre-consume the body on 2xx.
      const model = req.model ?? config.defaultChatModel;
      checkProviderKey(model);
      const callerStreamOptions =
        (req.extras as { stream_options?: Record<string, unknown> } | undefined)?.stream_options ??
        {};
      const body = JSON.stringify({
        ...req.extras,
        model,
        messages: req.messages,
        user: req.userId, // D-03
        stream: true,
        stream_options: { include_usage: true, ...callerStreamOptions },
      });
      // T-08.2-01: NO per-call dispatcher option — rely on the process-wide
      // SSRF agent set via setGlobalDispatcher. Forward signal + bodyTimeout.
      // Default bodyTimeout: 0 (no body-read timeout — long-lived SSE).
      const requestOpts: Record<string, unknown> = {
        method: "POST",
        headers: {
          ...authHeaders(req.userId, req.requestId),
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
      // caller streams it). On non-2xx we drain body.text() once to
      // populate the error, mirroring ensureOk's behaviour for parity
      // with the other client methods.
      if (res.statusCode >= 400) {
        const bodyText = await res.body.text();
        throw new LitellmUpstreamError(res.statusCode, bodyText);
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
        args.body.pipe(through);
        body = through;
      }

      const url = `${config.baseUrl}/v1/audio/transcriptions?model=${encodeURIComponent(model)}`;
      const reqOpts: Record<string, unknown> = {
        method: "POST",
        headers: {
          ...authHeaders(args.userId, args.requestId),
          "content-type": args.contentType,
        },
        body,
        headersTimeout: args.headersTimeout ?? DEFAULT_HEADERS_TIMEOUT_MS,
        bodyTimeout: args.bodyTimeout ?? DEFAULT_BODY_TIMEOUT_MS,
      };
      if (args.signal) reqOpts.signal = args.signal;
      const res = await doRequest(url, reqOpts as Parameters<typeof doRequest>[1]);
      return ensureOk(res);
    },

    async passthrough(path, args) {
      ssrfGate();
      const headers: Record<string, string> = authHeaders(args.userId, args.requestId);
      if (args.contentType) headers["content-type"] = args.contentType;
      // Phase 41.f / HI-1 — forward headersTimeout / bodyTimeout / signal.
      const reqOpts: Record<string, unknown> = {
        method: args.method as Dispatcher.HttpMethod,
        headers,
        headersTimeout: args.headersTimeout ?? DEFAULT_HEADERS_TIMEOUT_MS,
        bodyTimeout: args.bodyTimeout ?? DEFAULT_BODY_TIMEOUT_MS,
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
  DEFAULT_LITELLM_BASE_URL,
  loadLitellmConfigFromEnv,
} from "./config.js";
export {
  LitellmUpstreamError,
  MissingProviderKeyError,
  SsrfDispatcherNotInstalledError,
} from "./errors.js";
export { getDefaultAgentModel, loadLitellmModelAliases } from "./model-aliases.js";
