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
 * The 4 client-declared request classes (BACKEND_SPEC `requestKind`). The
 * client (≥ v1.7.18) sets this explicitly on every /api/reason call:
 * `"cleanup"` for dictation cleanup, `"agent"`/`"summary"`/`"title"` for the
 * reasoning paths.
 */
export type RequestKind = "cleanup" | "agent" | "summary" | "title";

/** The internal routing class the two layers branch on. */
export type RequestClass = "cleanup" | "reasoning";

const REQUEST_KINDS: readonly RequestKind[] = ["cleanup", "agent", "summary", "title"];

/**
 * Narrow an arbitrary (passthrough-tolerated) `requestKind` value to one of
 * the 4 known literals. Unknown / null / undefined / wrong-type → `false`.
 *
 * Fail-SAFE: a garbage value never throws and never 400s upstream (the wire
 * schema bounds it as a plain string, NOT `z.enum`) — it just fails this
 * guard so the caller falls back to the legacy shape heuristic.
 */
export function isRequestKind(value: unknown): value is RequestKind {
  return typeof value === "string" && (REQUEST_KINDS as readonly string[]).includes(value);
}

/**
 * PRIMARY router. Maps an explicit `body.requestKind` to the internal routing
 * class, IGNORING the `agentName`/`systemPrompt`/`model` body shape:
 *
 *   - `"cleanup"`                    → `"cleanup"`
 *   - `"agent"` | `"summary"` | `"title"` → `"reasoning"`
 *   - absent / null / garbage        → `undefined` (caller falls back to the
 *                                       {@link isCleanupRequest} heuristic)
 *
 * `agentName` is deliberately NOT consulted — it is always non-empty from the
 * client's localStorage and is useless for the cleanup-vs-reasoning decision.
 */
export function resolveRequestClass(body: ReasonRequest): RequestClass | undefined {
  const kind = (body as { requestKind?: unknown }).requestKind;
  if (!isRequestKind(kind)) return undefined;
  return kind === "cleanup" ? "cleanup" : "reasoning";
}

/**
 * The FALLBACK cleanup SHAPE heuristic, used ONLY when no explicit (valid)
 * `requestKind` is present. This is the PERMANENT compatibility layer for
 * clients that do not send `requestKind` — the deployed desktop client
 * ≤ v1.7.17 and all upstream OpenWhispr clients (which never send it).
 *
 * The cleanup shape is: NO `systemPrompt` AND empty/absent `model`. The
 * discriminator is `systemPrompt`: a real agent dictation ALWAYS forwards a
 * non-empty `systemPrompt` (the client's agent branch sends
 * `resolvePrompt("dictationAgent")`), whereas a cleanup dictation sends none.
 *
 * `agentName` is NOT consulted — it is always non-empty from the client's
 * localStorage even for a cleanup dictation made while an agent is configured.
 * Consulting it (the previous `agentAbsent && …` formula) misrouted exactly
 * that case — cleanup-while-agent-configured — to the reasoning model with
 * thinking ON (the live regression this fix addresses).
 *
 * `model` is kept as defence-in-depth: a request carrying an explicit model
 * but no systemPrompt routes to reasoning, not cleanup (the explicit model is
 * an intentional reasoning signal). On the deployed clients `model` is never
 * sent, so this term is inert for them — it only guards future/other clients.
 *
 * `ReasonRequest` declares the fields `.nullish()` (`string | null |
 * undefined`); `model` may additionally be `""` (a fresh session before the
 * store resolves a model). "absent" therefore means `=== undefined || ===
 * null` for systemPrompt, plus `=== ""` for model.
 */
export function isCleanupRequest(body: ReasonRequest): boolean {
  const systemAbsent = body.systemPrompt === undefined || body.systemPrompt === null;
  const model = body.model;
  const modelAbsent = model === undefined || model === null || model === "";
  return systemAbsent && modelAbsent;
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
 * Resolve the cleanup-shape system message via the THREE-tier
 * precedence (the verified cleanup contract):
 *
 *   1. `body.customPrompt` non-empty → use it VERBATIM. This is the
 *      user's Prompt-Studio override (the immutable client sends
 *      `customPrompt = settings.customPrompts.cleanup`, populated only
 *      when the user saved a custom cleanup prompt). The user's explicit
 *      choice wins over the server default.
 *   2. else → the server's localized default `prompts.cleanupPrompt`.
 *
 * `customPrompt` is `.nullish()` and may also be `""` — "non-empty"
 * means `typeof === "string" && trim().length > 0`, so a blank/whitespace
 * override falls through to the localized default rather than sending an
 * empty system message.
 */
function cleanupSystemContent(body: ReasonRequest, locale: SupportedLocale): string {
  const custom = body.customPrompt;
  if (typeof custom === "string" && custom.trim().length > 0) {
    return custom;
  }
  return cleanupPrompt(locale);
}

/**
 * Build the upstream `messages` array for a /api/reason request.
 *
 * Routing is PRIMARY-then-fallback: the explicit `requestKind` (via
 * {@link resolveRequestClass}) decides the class when present, otherwise the
 * {@link isCleanupRequest} shape heuristic does.
 *
 *   - cleanup class  → `[system(<cleanupSystemContent>), user(text)]`
 *     where `<cleanupSystemContent>` follows the three-tier precedence:
 *     non-empty `body.customPrompt` (Prompt-Studio override) → else the
 *     localized `prompts.cleanupPrompt` default. The body's `systemPrompt`
 *     is IGNORED for the cleanup class.
 *   - reasoning class w/ `systemPrompt` → `[system(systemPrompt), user(text)]`
 *   - reasoning class w/o `systemPrompt` → `[user(text)]` (NO system message)
 */
export function selectMessages(body: ReasonRequest, locale: SupportedLocale): ChatMessage[] {
  const userMsg: ChatMessage = { role: "user", content: body.text };
  const cleanupMessages = (): ChatMessage[] => [
    { role: "system", content: cleanupSystemContent(body, locale) },
    userMsg,
  ];
  // The reasoning shape uses `systemPrompt` as the persona when present, else
  // NO system message (the conversational default) — identical for the
  // PRIMARY "reasoning" class and the fallback non-cleanup path.
  const reasoningMessages = (): ChatMessage[] =>
    body.systemPrompt !== undefined && body.systemPrompt !== null
      ? [{ role: "system", content: body.systemPrompt }, userMsg]
      : [userMsg];

  // PRIMARY: an explicit requestKind decides, IGNORING the body shape.
  const cls = resolveRequestClass(body);
  if (cls === "cleanup") return cleanupMessages();
  if (cls === "reasoning") return reasoningMessages();

  // FALLBACK (requestKind absent/garbage): the legacy shape heuristic.
  return isCleanupRequest(body) ? cleanupMessages() : reasoningMessages();
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
  /**
   * #18 — per-model chat-completion param bag (litellm-style), keyed by the
   * resolved model alias. Sourced from `REASONING_MODEL_PARAMS` env via
   * `LitellmClientConfig.modelParams`. When an entry exists for the resolved
   * alias it becomes the request `extras` for ALL shapes (overriding the
   * cleanup thinking-off default); absent → backward-compat behaviour.
   *
   * SECURITY: this map is OPERATOR config only. `selectModelAndExtras` MUST
   * NOT merge any request-body field into the resulting extras — doing so
   * would let a client inject upstream params (model/tool/reasoning
   * override). Only `body.model` is read, and only to select the alias.
   */
  modelParams?: Record<string, Record<string, unknown>>;
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
  // PRIMARY: an explicit requestKind decides, IGNORING the body shape.
  const cls = resolveRequestClass(body);
  if (cls === "cleanup") return cleanupModelAndExtras(body, deps);
  if (cls === "reasoning") return reasoningModelAndExtras(body, deps);

  // FALLBACK (requestKind absent/garbage): the legacy shape heuristic.
  return isCleanupRequest(body)
    ? cleanupModelAndExtras(body, deps)
    : reasoningModelAndExtras(body, deps);
}

/**
 * Cleanup-class model + extras. `body.model || cleanupModel || DEFAULT` uses
 * `||` (NOT `??`) deliberately: the client sends `model:""` on a fresh
 * session, and `""` must fall through to the cleanup alias. Thinking-OFF is
 * the default unless an operator `modelParams` bag for the resolved alias
 * overrides it (#18). The bag is read ONLY from operator config, never the
 * request body (anti-injection — see {@link ModelSelectionDeps.modelParams}).
 */
function cleanupModelAndExtras(body: ReasonRequest, deps: ModelSelectionDeps): ModelAndExtras {
  const model = body.model || deps.cleanupModel || DEFAULT_CHAT_MODEL;
  const configured = resolveConfiguredExtras(deps.modelParams, model);
  return { model, extras: configured ?? { ...QWEN_THINKING_OFF_EXTRAS } };
}

/**
 * Reasoning-class model + extras. `body.model ?? defaultModel ?? DEFAULT`
 * uses `??` to match the historical agent-branch resolution. NO forced
 * thinking-off; an operator `modelParams` bag for the resolved alias applies
 * if present (#18), else no extras. Same anti-injection guarantee as
 * {@link cleanupModelAndExtras}.
 */
function reasoningModelAndExtras(body: ReasonRequest, deps: ModelSelectionDeps): ModelAndExtras {
  const model = body.model ?? deps.defaultModel ?? DEFAULT_CHAT_MODEL;
  const configured = resolveConfiguredExtras(deps.modelParams, model);
  return configured ? { model, extras: configured } : { model };
}

/**
 * Return a SHALLOW COPY of the operator-configured extras bag for `model`,
 * or `undefined` when no bag is configured for that alias.
 *
 * The copy guarantees the caller cannot mutate the shared config object,
 * and — critically — the returned object is built ONLY from
 * `modelParams[model]` (operator env), never from the request body. This
 * is the anti-injection seam (see {@link ModelSelectionDeps.modelParams}).
 */
function resolveConfiguredExtras(
  modelParams: Record<string, Record<string, unknown>> | undefined,
  model: string,
): Record<string, unknown> | undefined {
  const bag = modelParams?.[model];
  if (bag === undefined) return undefined;
  return { ...bag };
}
