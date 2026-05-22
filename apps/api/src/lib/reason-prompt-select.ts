// SPDX-License-Identifier: FSL-1.1-ALv2
// R33 (quick-task 20260522) — /api/reason prompt-selection helper.
//
// PROBLEM: the immutable desktop client deliberately does NOT send a
// cleanup `systemPrompt` on the cloud path (the cleanup prompt lives
// client-side, local-path only). For cloud cleanup the client sends
// `model`/`agentName`/`systemPrompt` all absent. Without a system
// message the model treats the bare transcript as a chat turn and
// answers conversationally instead of returning cleaned text.
//
// FIX: this pure module owns BOTH (a) the request-SHAPE detection and
// (b) the prompt + model selection keyed on that shape. `reason.ts`
// consumes it; the client stays untouched.
//
// LAYER 1 — prompt selection (persona). The cleanup prompt is a
//   LOCALIZED i18n resource (`prompts.cleanupPrompt`, namespace
//   registered in `i18n/init.ts`) — never a route-baked string literal
//   (LOCKER-03). The `{{agentName}}` placeholder is kept LITERAL
//   (anti-injection framing): the i18next lookup suppresses interpolation.
// LAYER 2 — model routing + thinking-off (see Commit 2).

import { DEFAULT_CHAT_MODEL } from "@openwhispr/litellm-client";
import type { ReasonRequest } from "@openwhispr/wire-schemas";
import { i18n } from "../i18n/init.js";

/** Locales the api ships cleanup prompts for. Unknown → "en". */
export type SupportedLocale = "en" | "ru";

/**
 * The cleanup SHAPE: NO `agentName` AND NO `systemPrompt` AND empty/absent
 * `model`. `ReasonRequest` declares all three `.nullish()`
 * (`string | null | undefined`); `model` may additionally be the empty
 * string `""` (the client sends `"model":""` on a fresh session before
 * the store resolves a model). "absent" therefore means
 * `=== undefined || === null` for agentName/systemPrompt, plus `=== ""`
 * for model.
 *
 * When this returns `true` the request is a dictation-cleanup call and
 * gets the cleanup persona + fast-model routing; otherwise it is an agent
 * call and keeps the conversational behaviour.
 */
export function isCleanupRequest(body: ReasonRequest): boolean {
  const agentAbsent = body.agentName === undefined || body.agentName === null;
  const systemAbsent = body.systemPrompt === undefined || body.systemPrompt === null;
  const model = body.model;
  const modelAbsent = model === undefined || model === null || model === "";
  return agentAbsent && systemAbsent && modelAbsent;
}

/**
 * Resolve the request locale to a supported cleanup-prompt locale.
 *
 * Precedence: `body.language` → `body.locale` → i18next-resolved
 * `reqLanguage` (Accept-Language) → `"en"`. Region tags are stripped
 * (`ru-RU` → `ru`); anything that is not a supported locale → `"en"`.
 */
export function resolveLocale(
  body: ReasonRequest,
  reqLanguage: string | undefined,
): SupportedLocale {
  const candidates = [body.language, body.locale, reqLanguage];
  for (const raw of candidates) {
    if (raw === undefined || raw === null || raw === "") continue;
    const base = raw.toLowerCase().split("-")[0];
    if (base === "ru") return "ru";
    if (base === "en") return "en";
  }
  return "en";
}

/**
 * Look up the localized cleanup prompt. Interpolation is SUPPRESSED so
 * the literal `{{agentName}}` placeholder survives verbatim into the
 * system message — it is anti-injection framing, not a template hole to
 * fill. `i18n/init.ts` already sets `interpolation.escapeValue = false`;
 * `skipOnVariables: true` additionally tells i18next to leave any
 * `{{...}}` token in place rather than resolving it to an empty string.
 */
function cleanupPrompt(locale: SupportedLocale): string {
  return i18n.t("prompts.cleanupPrompt", {
    lng: locale,
    interpolation: { skipOnVariables: true },
  });
}

/** A single OpenAI-compatible chat message. */
export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/**
 * Build the upstream `messages` array for a /api/reason request.
 *
 *   - cleanup shape  → `[system(localized cleanupPrompt), user(text)]`
 *   - agent shape w/ `systemPrompt` → `[system(systemPrompt), user(text)]`
 *   - agent shape w/ only `agentName` → `[user(text)]`
 *
 * The agentName-only branch deliberately emits NO system message — that
 * is today's behaviour and R33 must not regress it (the cleanup persona
 * is added ONLY for the cleanup shape).
 */
export function selectMessages(body: ReasonRequest, locale: SupportedLocale): ChatMessage[] {
  const userMsg: ChatMessage = { role: "user", content: body.text };
  if (isCleanupRequest(body)) {
    return [{ role: "system", content: cleanupPrompt(locale) }, userMsg];
  }
  if (body.systemPrompt !== undefined && body.systemPrompt !== null) {
    return [{ role: "system", content: body.systemPrompt }, userMsg];
  }
  return [userMsg];
}

// ---------------------------------------------------------------------------
// LAYER 2 — model routing + thinking-OFF.
// ---------------------------------------------------------------------------

/**
 * Qwen3 hybrid-reasoning thinking-OFF request-body field.
 *
 * Qwen3 disables its reasoning/thinking pass via the chat-template kwarg
 * `enable_thinking: false`. That kwarg is NOT OpenAI-API-native, so per
 * the Qwen official deployment docs
 * (qwen.readthedocs.io/en/latest/deployment/vllm.html — "passing
 * enable_thinking is not OpenAI API compatible") it MUST be nested inside
 * `extra_body.chat_template_kwargs`. vLLM and SGLang both consume
 * `chat_template_kwargs` this way; LiteLLM forwards unknown top-level
 * body keys (including `extra_body`) straight through to the upstream.
 *
 * CRITICAL: thinking-off travels in the REQUEST BODY, never in
 * `litellm_config.yaml`. The yaml maps alias -> endpoint only. This
 * constant is spread into `chatCompletions({ extras })`, which the
 * litellm-client spreads top-level into the JSON body.
 */
export const QWEN_THINKING_OFF_EXTRAS = {
  extra_body: { chat_template_kwargs: { enable_thinking: false } },
} as const;

/** Operator-owned model aliases threaded from `ReasonDeps` (LOCKER-01). */
export interface ModelSelectionDeps {
  /** Fast cleanup-class alias (env `REASONING_CLEANUP_MODEL`). */
  cleanupModel?: string;
  /** Default conversational chat alias (env `LITELLM_DEFAULT_CHAT_MODEL`). */
  defaultModel?: string;
}

/** Resolved upstream model + optional pass-through extras for a request. */
export interface ModelAndExtras {
  model: string;
  /** Present (thinking-off) for the cleanup shape; `undefined` otherwise. */
  extras?: Record<string, unknown>;
}

/**
 * Resolve the upstream model alias and pass-through `extras` for a
 * /api/reason request.
 *
 *   - cleanup shape → `body.model || cleanupModel || DEFAULT_CHAT_MODEL`,
 *     with thinking-OFF extras. The `||` (NOT `??`) is deliberate: the
 *     client sends `model:""` on a fresh session, and `""` must fall
 *     through to the cleanup alias.
 *   - agent shape → `body.model ?? defaultModel ?? DEFAULT_CHAT_MODEL`,
 *     NO extras (thinking left as-is). `??` here matches the route's
 *     historical resolution — `null`/absent fall through, but the agent
 *     branch is only reached when `model` is already non-empty or another
 *     agent signal is present.
 *
 * An explicit non-empty `body.model` always wins in both branches.
 */
export function selectModelAndExtras(
  body: ReasonRequest,
  deps: ModelSelectionDeps,
): ModelAndExtras {
  if (isCleanupRequest(body)) {
    const model = body.model || deps.cleanupModel || DEFAULT_CHAT_MODEL;
    return { model, extras: { ...QWEN_THINKING_OFF_EXTRAS } };
  }
  const model = body.model ?? deps.defaultModel ?? DEFAULT_CHAT_MODEL;
  return { model };
}
