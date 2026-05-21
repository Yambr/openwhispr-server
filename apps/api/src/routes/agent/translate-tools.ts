// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 04 / Plan 06 / Task 1 — pure helpers consumed by /api/agent/stream.
//
// Two pure functions, no I/O, no Fastify dependencies — composable in the
// route handler under @apps/api/src/routes/agent/stream.ts and trivially
// unit-testable to ≥90/90/90/90.
//
// translateLegacyTools (D-07): the desktop's wire shape for `tools` is
// the BACKEND_SPEC legacy form `[{name, description?, parameters}]`. LiteLLM
// (and OpenAI Chat Completions) expects the OpenAI form
// `[{type:"function", function:{name, description?, parameters}}]`. The
// translation is mechanical and lossless. We preserve order so the model's
// per-tool index referenced in delta.tool_calls[].index continues to map
// cleanly through the chain.
//
// prependSystemPrompt (D-11): when the desktop sets `body.systemPrompt` it
// is ADDITIVE — we insert it as `messages[0]` even if the caller already
// has a leading system message. We MUST NOT replace the existing system
// message (D-11 explicit: "Never replace an existing system message").
// Additive prepend is the least-surprising semantic and lets multi-tool
// agents stack guidance without losing the upstream prompt.

// Phase 52 / Plan 52-06 — explicit `| undefined` on the optional
// matches the wire-schema's zod inference under
// `exactOptionalPropertyTypes: true`. Same observable behaviour;
// downstream `tool.description ?? "..."` consumers unchanged.
//
// R28 (quick-task 20260522) — `description` is `string | null | undefined`:
// the wire schema (AgentLegacyToolSchema) widened the field to `.nullish()`
// so a client may send `"description":null`. translateLegacyTools collapses
// a `null` to `undefined` at the boundary so the OpenAI tool shape carries
// `string | undefined`.
export interface LegacyTool {
  name: string;
  description?: string | null | undefined;
  parameters: unknown;
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string | undefined;
    parameters: unknown;
  };
}

export interface ChatMessage {
  role: string;
  content: unknown;
}

/**
 * Translate the desktop's legacy `tools` array shape (BACKEND_SPEC) to
 * OpenAI's `tools` shape that LiteLLM expects. `undefined` flows through
 * unchanged so callers can spread the result conditionally without
 * branching: `{ ...(translated ? { tools: translated } : {}) }`.
 */
export function translateLegacyTools(tools: LegacyTool[] | undefined): OpenAITool[] | undefined {
  if (tools === undefined) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      // R28 — collapse a client-sent `null` description to `undefined`
      // (the OpenAITool shape carries `string | undefined`).
      description: t.description ?? undefined,
      parameters: t.parameters,
    },
  }));
}

/**
 * Prepend a system prompt to the messages array. Returns the input array
 * unchanged when `systemPrompt` is falsy (undefined or empty string) so
 * the route handler doesn't need to branch around the helper. When
 * present, the new system message is inserted at index 0; any pre-existing
 * system message stays in place (now at index 1) — D-11 forbids replace.
 */
export function prependSystemPrompt(
  messages: ChatMessage[],
  systemPrompt: string | undefined,
): ChatMessage[] {
  if (!systemPrompt) return messages;
  return [{ role: "system", content: systemPrompt }, ...messages];
}
