// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 Plan 03 Task 1 — LiteLLM client config loader.
// Phase 68 / Plan 68-01 — REVIEW litellm-client HIGH HI-2 + HI-3.
//
// Single source of truth for the LITELLM_BASE_URL / LITELLM_MASTER_KEY
// pair (PROVIDER-01 / LITELLM-05). Default base URL points at the
// docker-compose-bundled `litellm` service; corporate operators override
// LITELLM_BASE_URL to e.g. https://aimodels.inner.alfaleasing.ru and the
// rest of the codebase follows automatically — that is the entire point
// of routing all STT/LLM/realtime through one LiteLLM endpoint.
//
// Upstream credential precedence (HI-2): when `LITELLM_VIRTUAL_KEY` is
// set and non-empty it WINS over `LITELLM_MASTER_KEY` and becomes
// `config.masterKey` (the field `authHeaders()` consumes). This is the
// corporate-override path — operators pointing at their internal LiteLLM
// provision a virtual key rather than handing out the master key. With
// `LITELLM_VIRTUAL_KEY` unset the loader falls back to
// `LITELLM_MASTER_KEY` (back-compat). SOME key is always required.
//
// Base-URL scheme assertion (HI-3): an operator-OVERRIDDEN
// `LITELLM_BASE_URL` MUST use `https://` in production — otherwise the
// upstream Authorization header crosses a routable hop in plaintext. A
// non-https override in production is REFUSED unless `LITELLM_ALLOW_PLAINTEXT`
// is truthy OR the host is the bundled `litellm` compose service. The
// bundled default (not an override) is unaffected, and non-production
// stays http-friendly for the slim/dev stack. This
// mirrors the Phase 57 `validateIngressBoot` posture. This module is a
// `config/*` file, so the `NODE_ENV` read here is LOCKER-01 permitted.
//
// providerKeys are surfaced so the client can pre-check them before
// firing a request that would otherwise return upstream 401 (RESEARCH
// Pitfall #8).

import { parsePositiveIntEnv } from "./env-parse.js";

export interface LitellmProviderKeys {
  openrouter: string | undefined;
  groq: string | undefined;
  pyannote: string | undefined;
}

export interface LitellmClientConfig {
  baseUrl: string;
  masterKey: string;
  providerKeys: LitellmProviderKeys;
  /** Default model for chatCompletions when caller omits it (D-06). */
  defaultChatModel: string;
  /**
   * Default STT alias forwarded to `/v1/audio/transcriptions` when the
   * caller omits a model (D2/D6). Operator-owned via `LITELLM_STT_MODEL`
   * — the alias resolution lives in the LiteLLM proxy catalog, never as a
   * TypeScript literal in a route file.
   */
  defaultSttModel: string;
  /**
   * Default realtime model alias (D4/D1). Operator-owned via
   * `LITELLM_REALTIME_MODEL`. Surfaced here so both the realtime proxy
   * route (D1 task) and the OpenAI-realtime token mint read ONE source of
   * truth instead of two divergent literals.
   */
  defaultRealtimeModel: string;
  /**
   * R33 — fast cleanup-class model alias for /api/reason dictation-cleanup
   * requests. Operator-owned via `REASONING_CLEANUP_MODEL`; falls back to
   * {@link DEFAULT_CLEANUP_MODEL}. The /api/reason route routes the
   * cleanup request shape (no agentName, no systemPrompt, empty/absent
   * model) to this alias with reasoning/thinking disabled — see
   * `apps/api/src/lib/reason-prompt-select.ts`. The alias resolution
   * lives in the LiteLLM proxy catalog, never as a route literal.
   */
  defaultCleanupModel: string;
  /**
   * U65 — operator-owned embeddings model alias for POST /api/embeddings.
   * Operator-owned via `LITELLM_EMBEDDING_MODEL`. Unlike the STT/realtime/
   * cleanup aliases there is intentionally NO literal default: when the env
   * is unset this field is ABSENT (undefined), the /api/embeddings route
   * returns a clean 503 (operator-config), and capabilities.features.embeddings
   * is false. There is NO client-side fallback — server-or-clean-error. The
   * alias resolution lives in the operator gateway catalog, never as a route
   * literal.
   */
  defaultEmbeddingModel?: string;
  /**
   * U65 — operator-owned rerank model alias for POST /api/rerank. Operator-
   * owned via `LITELLM_RERANK_MODEL`; same no-literal-default seam as
   * {@link defaultEmbeddingModel} (unset → undefined → clean 503 + capability
   * flag false, no fallback).
   */
  defaultRerankModel?: string;
  /**
   * #18 — per-model chat-completion param bag (litellm-style). A map of
   * model alias → an arbitrary extras object the server spreads VERBATIM
   * into the upstream chat-completion body (the same way LiteLLM forwards
   * `litellm_params`). Operator-owned via `REASONING_MODEL_PARAMS`
   * (JSON map); provider-specific syntax (`reasoning:{enabled:false}` for
   * OpenRouter, `extra_body.chat_template_kwargs` for vLLM, etc.) is placed
   * in the env BY HAND — the server does NOT translate intent→syntax.
   * Unset/empty → `{}`. Malformed JSON, a non-object top level, or a
   * non-object per-alias value REFUSES to load (boot surfaces it as
   * EX_CONFIG exit 78), same loud-fail posture as a missing master key.
   *
   * SECURITY: this bag is safe to spread ONLY because its source is
   * operator env, never a request. The /api/reason resolver MUST never
   * merge request-body fields into it (that would be an upstream-injection
   * vector). See `apps/api/src/lib/reason-prompt-select.ts`.
   */
  modelParams: Record<string, Record<string, unknown>>;
  /**
   * R32 — default undici `headersTimeout` (ms) for the non-streaming
   * methods (chat / transcribe / passthrough). Operator-owned via
   * `LITELLM_HEADERS_TIMEOUT_MS`; falls back to {@link DEFAULT_HEADERS_TIMEOUT_MS}.
   * Per-call `headersTimeout` overrides still win.
   */
  headersTimeoutMs: number;
  /**
   * R32 — default undici `bodyTimeout` (ms) for the non-streaming methods.
   * Operator-owned via `LITELLM_BODY_TIMEOUT_MS`; falls back to
   * {@link DEFAULT_BODY_TIMEOUT_MS}. Per-call `bodyTimeout` overrides still
   * win. Does NOT affect the streaming path (long-lived SSE keeps
   * `bodyTimeout: 0`).
   */
  bodyTimeoutMs: number;
  /**
   * R32 — bound on the non-2xx error-body drain in `chatCompletionsStream`.
   * Operator-owned via `LITELLM_ERROR_DRAIN_TIMEOUT_MS`; falls back to
   * {@link DEFAULT_ERROR_DRAIN_TIMEOUT_MS}.
   */
  errorDrainTimeoutMs: number;
  /**
   * litellm-patterns A4 — total attempts (initial + retries) for the
   * `chatCompletions` retry loop. Operator-owned via
   * `LITELLM_RETRY_MAX_ATTEMPTS`; falls back to
   * {@link DEFAULT_RETRY_MAX_ATTEMPTS} (3 = 1 try + 2 retries). The
   * streaming + audio-transcription paths are NEVER retried.
   */
  retryMaxAttempts: number;
  /**
   * litellm-patterns A4 — exponential-backoff base (ms) used when the
   * upstream did not supply a usable `Retry-After`. Operator-owned via
   * `LITELLM_RETRY_BASE_MS`; falls back to {@link DEFAULT_RETRY_BASE_MS}.
   */
  retryBaseMs: number;
  /**
   * litellm-patterns A4 — absolute upper bound (ms) on any single
   * retry-backoff delay. Operator-owned via `LITELLM_RETRY_CAP_MS`;
   * falls back to {@link DEFAULT_RETRY_CAP_MS}. Also serves as the
   * acceptance cap on a parsed upstream `Retry-After`: a hint above this
   * cap is treated as "use jittered exponential instead".
   */
  retryCapMs: number;
  /**
   * Upstream #4 — OPT-IN configurable HTTP header carrying the
   * authenticated end-user's EMAIL (or fallback UUID) on every gateway
   * call. Operator-owned via `LITELLM_USER_HEADER_NAME`. When `undefined`
   * (the default — empty string treated as unset) NO such header is
   * emitted: there is no literal default header name in route or client
   * code (LOCKER-03). When set, `authHeaders` emits
   * `{[userHeaderName]: endUser}` ONLY when `endUser` is also present.
   *
   * SECURITY (T-oc4-01): the header NAME is operator-controlled, so the
   * loader REFUSES a value containing CR/LF or a colon — an operator typo
   * cannot inject a second header or split the outbound request. The body
   * `user` field carries email-or-UUID regardless of this header;
   * `x-litellm-end-user-id` always stays the stable UUID (D-1).
   */
  userHeaderName?: string;
}

export const DEFAULT_LITELLM_BASE_URL = "http://litellm:4000";
export const DEFAULT_CHAT_MODEL = "qwen3.6-plus";
/**
 * D2/D6 — literal fallback for `LITELLM_STT_MODEL`. This is the bundled
 * Groq Whisper alias in `compose/litellm/litellm_config.yaml`; it stays a
 * literal ONLY as the env-default, never as a route-baked constant.
 */
export const DEFAULT_STT_MODEL = "whisper-large-v3";
/**
 * D4/D1 — literal fallback for `LITELLM_REALTIME_MODEL`. Bundled OpenAI
 * realtime alias; literal ONLY as the env-default.
 */
export const DEFAULT_REALTIME_MODEL = "gpt-realtime";
/**
 * R33 — literal fallback for `REASONING_CLEANUP_MODEL`. The bundled
 * cleanup alias in `compose/litellm/litellm_config.yaml`; it stays a
 * literal ONLY as the env-default, never as a route-baked constant.
 */
export const DEFAULT_CLEANUP_MODEL = "qwen3.6-cleanup";

/**
 * @internal — Plan 51-15b (REVIEW HIGH HI-4) / R32. Literal fallback for
 * `LITELLM_HEADERS_TIMEOUT_MS`. Phase 41.f / HI-1 picked 30s as the
 * conservative `headersTimeout` for the non-streaming methods; it stays a
 * literal ONLY as the env-default. Production callers MUST NOT depend on
 * this name — read `LitellmClientConfig.headersTimeoutMs` instead.
 */
export const DEFAULT_HEADERS_TIMEOUT_MS = 30_000;
/**
 * @internal — Plan 51-15b (REVIEW HIGH HI-4) / R32. Literal fallback for
 * `LITELLM_BODY_TIMEOUT_MS`. Phase 41.f / HI-1 picked 120s as the
 * conservative `bodyTimeout` for the non-streaming methods; it stays a
 * literal ONLY as the env-default. Production callers MUST NOT depend on
 * this name — read `LitellmClientConfig.bodyTimeoutMs` instead.
 */
export const DEFAULT_BODY_TIMEOUT_MS = 120_000;
/**
 * @internal — Plan 51-06 (REVIEW CR-12) / R32. Literal fallback for
 * `LITELLM_ERROR_DRAIN_TIMEOUT_MS` — the bound on the non-2xx error-body
 * drain in `chatCompletionsStream` (15s; literal ONLY as the env-default).
 * Production callers MUST NOT depend on this name — read
 * `LitellmClientConfig.errorDrainTimeoutMs` instead.
 */
export const DEFAULT_ERROR_DRAIN_TIMEOUT_MS = 15_000;
/**
 * @internal — litellm-patterns A4. Literal fallback for
 * `LITELLM_RETRY_MAX_ATTEMPTS`. 3 total attempts = 1 try + 2 retries; it
 * stays a literal ONLY as the env-default. Production callers MUST NOT
 * depend on this name — read `LitellmClientConfig.retryMaxAttempts` instead.
 */
export const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
/**
 * @internal — litellm-patterns A4. Literal fallback for
 * `LITELLM_RETRY_BASE_MS` (exponential-backoff base, 250 ms). Literal
 * ONLY as the env-default. Production callers MUST NOT depend on this
 * name — read `LitellmClientConfig.retryBaseMs` instead.
 */
export const DEFAULT_RETRY_BASE_MS = 250;
/**
 * @internal — litellm-patterns A4. Literal fallback for
 * `LITELLM_RETRY_CAP_MS` (per-attempt backoff cap, 8 s). Literal ONLY as
 * the env-default. Production callers MUST NOT depend on this name —
 * read `LitellmClientConfig.retryCapMs` instead.
 */
export const DEFAULT_RETRY_CAP_MS = 8_000;

/** Compose service name of the bundled LiteLLM proxy (slim/dev stack). */
const BUNDLED_LITELLM_HOST = "litellm";

/** True for a plain JSON object (`{}`), false for arrays / null / primitives. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse `REASONING_MODEL_PARAMS` into a validated alias → extras-bag map.
 *
 * Unset/empty → `{}`. Anything malformed REFUSES with a thrown Error
 * (the boot path turns it into EX_CONFIG exit 78, same as a missing
 * master key) rather than silently ignoring operator misconfig:
 *   - not parseable as JSON
 *   - top level is not a plain object (array / string / number / null)
 *   - any per-alias value is not a plain object
 */
function parseModelParams(raw: string | undefined): Record<string, Record<string, unknown>> {
  if (raw === undefined || raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "invalid JSON";
    throw new Error(`REASONING_MODEL_PARAMS must be a valid JSON object: ${reason}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      "REASONING_MODEL_PARAMS must be a JSON object mapping model alias -> params object",
    );
  }
  const out: Record<string, Record<string, unknown>> = {};
  for (const [alias, bag] of Object.entries(parsed)) {
    if (!isPlainObject(bag)) {
      throw new Error(
        `REASONING_MODEL_PARAMS["${alias}"] must be a params object (got ${
          Array.isArray(bag) ? "array" : bag === null ? "null" : typeof bag
        })`,
      );
    }
    out[alias] = bag;
  }
  return out;
}

/**
 * Upstream #4 — resolve + validate `LITELLM_USER_HEADER_NAME`.
 *
 * Empty/unset → `undefined` (header is opt-in; same empty-is-unset seam as
 * the model envs). A non-empty value MUST be a single safe HTTP header
 * token: CR, LF and `:` are REFUSED (T-oc4-01) so an operator typo cannot
 * inject a second header or split the outbound request. The loud-fail
 * posture mirrors the master-key check — boot turns the throw into an
 * EX_CONFIG exit.
 */
function parseUserHeaderName(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  if (/[\r\n:]/.test(raw)) {
    throw new Error(
      "LITELLM_USER_HEADER_NAME must be a single HTTP header token without CR, LF or ':' " +
        "(an operator typo must not be able to inject a second header)",
    );
  }
  return raw;
}

export function loadLitellmConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LitellmClientConfig {
  // HI-2: LITELLM_VIRTUAL_KEY (corporate-override) wins over
  // LITELLM_MASTER_KEY; one of the two is always required.
  const virtualKey = env.LITELLM_VIRTUAL_KEY;
  const rawMasterKey = env.LITELLM_MASTER_KEY;
  const masterKey =
    virtualKey && virtualKey.length > 0
      ? virtualKey
      : rawMasterKey && rawMasterKey.length > 0
        ? rawMasterKey
        : undefined;
  if (!masterKey) {
    throw new Error("LITELLM_MASTER_KEY is required");
  }
  const baseUrlOverridden = Boolean(env.LITELLM_BASE_URL && env.LITELLM_BASE_URL.length > 0);
  const baseUrl = baseUrlOverridden ? (env.LITELLM_BASE_URL as string) : DEFAULT_LITELLM_BASE_URL;
  // HI-3: refuse a non-https operator override in production.
  if (baseUrlOverridden && env.NODE_ENV === "production") {
    const allowPlaintext = Boolean(
      env.LITELLM_ALLOW_PLAINTEXT && env.LITELLM_ALLOW_PLAINTEXT !== "0",
    );
    let host = "";
    try {
      host = new URL(baseUrl).hostname;
    } catch {
      host = "";
    }
    const isBundledHost = host === BUNDLED_LITELLM_HOST;
    if (!baseUrl.startsWith("https://") && !allowPlaintext && !isBundledHost) {
      throw new Error(
        "LITELLM_BASE_URL must use https:// in production. Set LITELLM_ALLOW_PLAINTEXT=1 " +
          "to opt out (not recommended — the upstream Authorization header would cross " +
          "a routable hop in plaintext).",
      );
    }
  }
  const defaultChatModel =
    env.LITELLM_DEFAULT_CHAT_MODEL && env.LITELLM_DEFAULT_CHAT_MODEL.length > 0
      ? env.LITELLM_DEFAULT_CHAT_MODEL
      : DEFAULT_CHAT_MODEL;
  // D2/D6 + D4/D1 — STT + realtime aliases follow the same env-override
  // seam as LITELLM_DEFAULT_CHAT_MODEL: an empty string is treated as
  // unset so a blank .env line does not shadow the bundled default.
  const defaultSttModel =
    env.LITELLM_STT_MODEL && env.LITELLM_STT_MODEL.length > 0
      ? env.LITELLM_STT_MODEL
      : DEFAULT_STT_MODEL;
  const defaultRealtimeModel =
    env.LITELLM_REALTIME_MODEL && env.LITELLM_REALTIME_MODEL.length > 0
      ? env.LITELLM_REALTIME_MODEL
      : DEFAULT_REALTIME_MODEL;
  // R33 — cleanup-class alias follows the same empty-string-is-unset seam.
  const defaultCleanupModel =
    env.REASONING_CLEANUP_MODEL && env.REASONING_CLEANUP_MODEL.length > 0
      ? env.REASONING_CLEANUP_MODEL
      : DEFAULT_CLEANUP_MODEL;
  // U65 — embeddings + rerank aliases follow the same empty-string-is-unset
  // seam, but with NO literal default: unset → undefined (no
  // DEFAULT_*_MODEL constant). The route returns a clean 503 and the
  // capability flag is false when the operator has not configured a model.
  const defaultEmbeddingModel =
    env.LITELLM_EMBEDDING_MODEL && env.LITELLM_EMBEDDING_MODEL.length > 0
      ? env.LITELLM_EMBEDDING_MODEL
      : undefined;
  const defaultRerankModel =
    env.LITELLM_RERANK_MODEL && env.LITELLM_RERANK_MODEL.length > 0
      ? env.LITELLM_RERANK_MODEL
      : undefined;
  // #18 — per-model chat-param extras bag (litellm-style). Malformed config
  // throws here → boot turns it into EX_CONFIG exit 78.
  const modelParams = parseModelParams(env.REASONING_MODEL_PARAMS);
  // R32 — undici timeout posture is operator-tunable via three env knobs;
  // each falls back to its prior hardcoded literal when unset/invalid.
  const headersTimeoutMs = parsePositiveIntEnv(
    env.LITELLM_HEADERS_TIMEOUT_MS,
    DEFAULT_HEADERS_TIMEOUT_MS,
  );
  const bodyTimeoutMs = parsePositiveIntEnv(env.LITELLM_BODY_TIMEOUT_MS, DEFAULT_BODY_TIMEOUT_MS);
  const errorDrainTimeoutMs = parsePositiveIntEnv(
    env.LITELLM_ERROR_DRAIN_TIMEOUT_MS,
    DEFAULT_ERROR_DRAIN_TIMEOUT_MS,
  );
  // litellm-patterns A4 — retry-loop posture is operator-tunable via
  // three env knobs; each falls back to its literal default when unset
  // or invalid. Mirrors the R32 timeout-knob pattern exactly.
  const retryMaxAttempts = parsePositiveIntEnv(
    env.LITELLM_RETRY_MAX_ATTEMPTS,
    DEFAULT_RETRY_MAX_ATTEMPTS,
  );
  const retryBaseMs = parsePositiveIntEnv(env.LITELLM_RETRY_BASE_MS, DEFAULT_RETRY_BASE_MS);
  const retryCapMs = parsePositiveIntEnv(env.LITELLM_RETRY_CAP_MS, DEFAULT_RETRY_CAP_MS);
  // Upstream #4 — opt-in configurable end-user email header. Validated +
  // empty-is-unset; CR/LF/`:` in the name REFUSES to load (T-oc4-01).
  const userHeaderName = parseUserHeaderName(env.LITELLM_USER_HEADER_NAME);
  return {
    baseUrl,
    masterKey,
    providerKeys: {
      openrouter: env.OPENROUTER_API_KEY ? env.OPENROUTER_API_KEY : undefined,
      groq: env.GROQ_API_KEY ? env.GROQ_API_KEY : undefined,
      pyannote: env.PYANNOTE_API_KEY ? env.PYANNOTE_API_KEY : undefined,
    },
    defaultChatModel,
    defaultSttModel,
    defaultRealtimeModel,
    defaultCleanupModel,
    // U65 — conditional spread keeps the embeddings/rerank aliases genuinely
    // ABSENT (not `: undefined`) under exactOptionalPropertyTypes when the env
    // is unset — same posture as `userHeaderName` below.
    ...(defaultEmbeddingModel !== undefined ? { defaultEmbeddingModel } : {}),
    ...(defaultRerankModel !== undefined ? { defaultRerankModel } : {}),
    modelParams,
    headersTimeoutMs,
    bodyTimeoutMs,
    errorDrainTimeoutMs,
    retryMaxAttempts,
    retryBaseMs,
    retryCapMs,
    // Conditional spread keeps `userHeaderName` genuinely ABSENT (not
    // `: undefined`) under `exactOptionalPropertyTypes` when the env is
    // unset — the header stays opt-in with no key leaking into the config.
    ...(userHeaderName !== undefined ? { userHeaderName } : {}),
  };
}
