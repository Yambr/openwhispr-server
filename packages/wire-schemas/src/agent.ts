// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 41.b / HI-02 — wire schema for POST /api/agent/stream.
 *
 * Previously the route did `const body = (req.body ?? {}) as RequestBody;`
 * — no validation. Malformed payloads crashed post-hijack and surfaced as
 * synthetic `stream_error` finish chunks under HTTP 200, bypassing the
 * canonical 400 envelope and confusing desktop clients. Cost-multiplier
 * attacks (huge `messages` arrays) were unchecked.
 *
 * Phase 39 patterns reapplied: `.strict()`; explicit caps on every array
 * length + string length.
 */
import { z } from "zod";

/**
 * Desktop's legacy ChatMessage shape (BACKEND_SPEC §/api/agent/stream).
 * `content` is intentionally `unknown` — desktop ships string content
 * BUT the OpenAI multi-modal shape allows arrays of parts. The route
 * forwards the shape unchanged to LiteLLM; we only assert presence + the
 * structural envelope.
 */
export const AgentChatMessageSchema = z
  .object({
    role: z.string().min(1).max(64),
    content: z.unknown(),
  })
  .strict();
export type AgentChatMessage = z.infer<typeof AgentChatMessageSchema>;

/**
 * Desktop's legacy tool descriptor (BACKEND_SPEC §/api/agent/stream).
 * The route translates this into OpenAI's `{type:"function", function:{...}}`
 * shape (see translateLegacyTools).
 */
export const AgentLegacyToolSchema = z
  .object({
    name: z.string().min(1).max(128),
    // R28 (quick-task 20260522): `.nullish()` — a client may send
    // `"description":null` for a tool without a description; `null` for
    // an unset optional field is valid JSON. `.optional()` rejected it.
    description: z.string().max(2048).nullish(),
    parameters: z.unknown(),
  })
  .strict();
export type AgentLegacyTool = z.infer<typeof AgentLegacyToolSchema>;

/**
 * Request body for POST /api/agent/stream.
 *
 * Caps:
 *   - messages: ≤ 50 entries (cost-multiplier cap; typical agent
 *     conversation < 30 turns)
 *   - tools: ≤ 64 entries (LiteLLM upstream caps lower in practice)
 *   - systemPrompt: ≤ 16_384 chars (≈ 4k tokens — long-prompt budget)
 *   - model: 1..128 chars (LiteLLM alias names + override paths)
 *   - sessionId / clientType / appVersion: ≤ 256 chars (metadata)
 *
 * R23 (quick-task 20260521): the immutable desktop client POSTs
 * sessionId / clientType / appVersion alongside `messages`. They are
 * now explicitly modeled, and the top-level `.strict()` is relaxed to
 * `.passthrough()` so future documented client fields no longer 400.
 * The sub-object schemas (AgentChatMessageSchema / AgentLegacyToolSchema)
 * keep their `.strict()` — their shape is fixed.
 *
 * R28 (quick-task 20260522): every optional field is `.nullish()`, NOT
 * `.optional()`. The immutable desktop client builds the body from
 * `opts.model` / `opts.systemPrompt`; on the FIRST dictation of a
 * session those are `null`, so the body literally carries
 * `"model":null`. `.optional()` rejected `null` — 400-ing the first
 * dictation. `.nullish()` admits it; the route handler treats `null`
 * identically to `undefined` (resolveModel `??`, prependSystemPrompt
 * falsy-check, tools null-skip). The `.max()` bounds still apply when a
 * non-null value IS present.
 */
export const AgentStreamRequestSchema = z
  .object({
    // The desktop's agent loop appends TWO messages per tool call — the
    // assistant's tool-call turn and its result — so this budget is spent twice
    // as fast as the number of calls. At 50 it was reachable by ordinary work:
    // a session that ran 24 tool calls sent 48 + 3 conversational = 51 and got
    // back a 400 "Invalid request" mid-task, after the agent had already
    // searched and read two dozen notes. The client's own ceiling is
    // MAX_TOOL_STEPS = 20 steps (several calls per step), so 256 puts the limit
    // where it belongs — on the client — and leaves the real anti-abuse control
    // to the request body size.
    messages: z.array(AgentChatMessageSchema).min(0).max(256),
    model: z.string().min(1).max(128).nullish(),
    systemPrompt: z.string().max(16_384).nullish(),
    tools: z.array(AgentLegacyToolSchema).max(64).nullish(),
    sessionId: z.string().max(256).nullish(),
    clientType: z.string().max(256).nullish(),
    appVersion: z.string().max(256).nullish(),
  })
  .passthrough();
export type AgentStreamRequest = z.infer<typeof AgentStreamRequestSchema>;
