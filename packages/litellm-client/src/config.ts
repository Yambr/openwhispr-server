// Phase 03 Plan 03 Task 1 — LiteLLM client config loader.
//
// Single source of truth for the LITELLM_BASE_URL / LITELLM_MASTER_KEY
// pair (PROVIDER-01 / LITELLM-05). Default base URL points at the
// docker-compose-bundled `litellm` service; corporate operators override
// LITELLM_BASE_URL to e.g. https://llm.internal.example.com and the
// rest of the codebase follows automatically — that is the entire point
// of routing all STT/LLM/realtime through one LiteLLM endpoint.
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

export function loadLitellmConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LitellmClientConfig {
  const masterKey = env.LITELLM_MASTER_KEY;
  if (!masterKey || masterKey.length === 0) {
    throw new Error("LITELLM_MASTER_KEY is required");
  }
  const baseUrl =
    env.LITELLM_BASE_URL && env.LITELLM_BASE_URL.length > 0
      ? env.LITELLM_BASE_URL
      : DEFAULT_LITELLM_BASE_URL;
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
