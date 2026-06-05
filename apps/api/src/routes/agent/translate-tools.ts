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
// normalizeSystemMessages (upstream-#14): D-11's additive prepend
// ("never replace an existing system message") is SUPERSEDED. The corp
// qwen/vLLM gateway's strict chat template rejects multiple/duplicate
// leading system messages, so the desktop's body — which carries BOTH a
// `messages[0]={role:"system",...}` AND a byte-identical `body.systemPrompt`
// — produced HTTP 400 on every cloud agent-chat request. The server now
// normalizes to EXACTLY ONE merged system message at index [0]: it
// accumulates every system fragment (the optional systemPrompt first, then
// each in-array system message in order), dedups byte-identical string
// fragments, joins distinct fragments with "\n\n", and preserves the
// relative order of all non-system messages. The merge preserves D-11's
// no-content-loss intent — nothing is dropped except exact duplicates.
// Owner decision: exactly one system message, strictly.

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
 * Normalize the messages array to EXACTLY ONE system message at index [0]
 * (upstream-#14 — SUPERSEDES D-11's additive prepend). The gateway's strict
 * chat template (qwen-class model) rejects more than one leading system
 * message, so we merge every system fragment into a single message:
 *   - Accumulate fragments in order: `systemPrompt` first (when truthy),
 *     then each `role==="system"` message's content in array order.
 *   - Dedup: skip a fragment that is a string byte-identical to a string
 *     fragment already accumulated. Non-string fragments (object/array
 *     content) are always included as-is — no equality attempt, no crash.
 *   - Join distinct STRING fragments with "\n\n"; a sole non-string
 *     fragment passes through unchanged.
 *   - Preserve the relative order of all non-system messages.
 * When there are no fragments (no `systemPrompt` and no in-array system
 * message), the non-system messages are returned unchanged. An empty-string
 * `systemPrompt` is treated as unset (the old falsy semantics).
 */
export function normalizeSystemMessages(
  messages: ChatMessage[],
  systemPrompt: string | undefined,
): ChatMessage[] {
  const systemFragments: unknown[] = [];
  if (systemPrompt) {
    systemFragments.push(systemPrompt);
  }
  const nonSystem: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      systemFragments.push(message.content);
    } else {
      nonSystem.push(message);
    }
  }

  // No system content at all → return the conversation untouched (case 6).
  if (systemFragments.length === 0) {
    return messages;
  }

  // Merge: join distinct STRING fragments with "\n\n", deduping
  // byte-identical strings. Non-string fragments are kept as-is. When the
  // only fragment is a single non-string value, emit it directly so object
  // content survives the round-trip (non-string content guard).
  if (systemFragments.length === 1) {
    return [{ role: "system", content: systemFragments[0] }, ...nonSystem];
  }

  const stringFragments: string[] = [];
  const nonStringFragments: unknown[] = [];
  for (const fragment of systemFragments) {
    if (typeof fragment === "string") {
      if (!stringFragments.includes(fragment)) {
        stringFragments.push(fragment);
      }
    } else {
      nonStringFragments.push(fragment);
    }
  }

  // If every fragment is a string we can produce the canonical "\n\n" join.
  // When non-string fragments are present we still join the string ones and
  // append a readable JSON rendering of each non-string fragment so nothing
  // is silently dropped (D-11 no-content-loss intent).
  const renderedNonString = nonStringFragments.map((f) => JSON.stringify(f));
  const mergedContent = [...stringFragments, ...renderedNonString].join("\n\n");

  return [{ role: "system", content: mergedContent }, ...nonSystem];
}
