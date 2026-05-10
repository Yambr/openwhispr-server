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

import type { Readable } from "node:stream";
import { type Dispatcher, request as undiciRequest } from "undici";
import type { LitellmClientConfig, LitellmProviderKeys } from "./config.js";
import { LitellmUpstreamError, MissingProviderKeyError } from "./errors.js";

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

export interface ChatCompletionRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  userId: string;
  requestId: string;
  /** Pass-through additional OpenAI chat-completion params (temperature, max_tokens, ...). */
  extras?: Record<string, unknown>;
}

export interface AudioTranscriptionRequest {
  body: Readable;
  contentType: string;
  userId: string;
  requestId: string;
}

export interface PassthroughRequest {
  method: string;
  body?: Readable | string | Buffer;
  contentType?: string;
  userId: string;
  requestId: string;
}

export interface LitellmClient {
  chatCompletions(req: ChatCompletionRequest): Promise<Dispatcher.ResponseData>;
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

export function buildLitellmClient(
  config: LitellmClientConfig,
  opts: BuildLitellmClientOptions = {},
): LitellmClient {
  const isOverride = opts.isOverride ?? Boolean(process.env.LITELLM_BASE_URL);
  const doRequest = opts.request ?? undiciRequest;

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
      const model = req.model ?? config.defaultChatModel;
      checkProviderKey(model);
      const body = JSON.stringify({
        ...req.extras,
        model,
        messages: req.messages,
        user: req.userId, // D-03: per-user attribution via OpenAI-compatible field
      });
      const res = await doRequest(`${config.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          ...authHeaders(req.userId, req.requestId),
          "content-type": "application/json",
        },
        body,
      });
      return ensureOk(res);
    },

    async audioTranscriptions(args) {
      checkProviderKey("whisper-large-v3");
      const res = await doRequest(`${config.baseUrl}/v1/audio/transcriptions`, {
        method: "POST",
        headers: {
          ...authHeaders(args.userId, args.requestId),
          "content-type": args.contentType,
        },
        body: args.body,
      });
      return ensureOk(res);
    },

    async passthrough(path, args) {
      const headers: Record<string, string> = authHeaders(args.userId, args.requestId);
      if (args.contentType) headers["content-type"] = args.contentType;
      const reqOpts: {
        method: Dispatcher.HttpMethod;
        headers: Record<string, string>;
        body?: Readable | string | Buffer;
      } = {
        method: args.method as Dispatcher.HttpMethod,
        headers,
      };
      if (args.body !== undefined) reqOpts.body = args.body;
      const res = await doRequest(`${config.baseUrl}${path}`, reqOpts);
      return ensureOk(res);
    },
  };
}

export type {
  LitellmClientConfig,
  LitellmProviderKeys,
} from "./config.js";
export { DEFAULT_CHAT_MODEL, DEFAULT_LITELLM_BASE_URL, loadLitellmConfigFromEnv } from "./config.js";
export { LitellmUpstreamError, MissingProviderKeyError } from "./errors.js";
