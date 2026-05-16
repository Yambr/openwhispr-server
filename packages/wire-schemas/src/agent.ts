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
    description: z.string().max(2048).optional(),
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
 */
export const AgentStreamRequestSchema = z
  .object({
    messages: z.array(AgentChatMessageSchema).min(0).max(50),
    model: z.string().min(1).max(128).optional(),
    systemPrompt: z.string().max(16_384).optional(),
    tools: z.array(AgentLegacyToolSchema).max(64).optional(),
  })
  .strict();
export type AgentStreamRequest = z.infer<typeof AgentStreamRequestSchema>;
