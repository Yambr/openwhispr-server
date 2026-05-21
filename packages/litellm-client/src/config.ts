// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 Plan 03 Task 1 — LiteLLM client config loader.
// Phase 68 / Plan 68-01 — REVIEW litellm-client HIGH HI-2 + HI-3.
//
// Single source of truth for the LITELLM_BASE_URL / LITELLM_MASTER_KEY
// pair (PROVIDER-01 / LITELLM-05). Default base URL points at the
// docker-compose-bundled `litellm` service; corporate operators override
// LITELLM_BASE_URL to e.g. https://llm.internal.example.com and the
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
// bundled `http://litellm:4000` default (not an override) is unaffected,
// and non-production stays http-friendly for the slim/dev stack. This
// mirrors the Phase 57 `validateIngressBoot` posture. This module is a
// `config/*` file, so the `NODE_ENV` read here is LOCKER-01 permitted.
//
// providerKeys are surfaced so the client can pre-check them before
// firing a request that would otherwise return upstream 401 (RESEARCH
// Pitfall #8).

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
}

export const DEFAULT_LITELLM_BASE_URL = "http://litellm:4000";
export const DEFAULT_CHAT_MODEL = "qwen3.6-plus";

/** Compose service name of the bundled LiteLLM proxy (slim/dev stack). */
const BUNDLED_LITELLM_HOST = "litellm";

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
  return {
    baseUrl,
    masterKey,
    providerKeys: {
      openrouter: env.OPENROUTER_API_KEY ? env.OPENROUTER_API_KEY : undefined,
      groq: env.GROQ_API_KEY ? env.GROQ_API_KEY : undefined,
      pyannote: env.PYANNOTE_API_KEY ? env.PYANNOTE_API_KEY : undefined,
    },
    defaultChatModel,
  };
}
