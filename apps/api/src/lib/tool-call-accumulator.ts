// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 04 / Plan 02 / Task 1 — Pure tool-call delta accumulator.
//
// OpenAI Chat Completions streaming emits `delta.tool_calls[].function.arguments`
// as JSON-string fragments keyed by `tool_calls[].index`. Fragments must be
// concatenated by index across deltas; the consolidated args string is
// forwarded verbatim on flush (when finish_reason === "tool_calls"). R32 —
// the consolidated string is NOT parsed server-side: the desktop client's
// cloud stream consumer expects `arguments` as a raw JSON string and parses
// it itself before executing the tool.
//
// Safety (T-04-03 mitigation): on finish_reason === "stop" with pending state
// (LiteLLM#17246 shape), the caller MUST NOT flush — the partial tool-call
// is dropped silently. flush() is the sole state-clearing path; we expose
// no public clear() so the only way to dispose pending state is to consume it.
//
// Coverage gate: ≥90/90/90/90 — every branch is hit by the seven Plan 04-02
// behavior tests.

// R32 — the immutable desktop client's cloud stream consumer
// (ReasoningService.processTextStreamingCloud) strictly filters NDJSON
// chunks on `type === "tool_call"` and reads `{ id, name, arguments }`,
// where `arguments` is a JSON STRING (not a parsed object). The client
// itself does `JSON.parse(arguments)` before executing the tool. Our
// wire shape therefore uses snake_case `tool_call` and forwards the
// accumulated arguments string verbatim.
export interface ToolCallChunk {
  type: "tool_call";
  id: string;
  name: string;
  /** Raw accumulated JSON-string of the tool arguments — NOT parsed. */
  arguments: string;
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

export interface DeltaWithToolCalls {
  tool_calls?: ToolCallDelta[];
}

export interface ToolCallAccumulator {
  absorb(delta: DeltaWithToolCalls): void;
  flush(): ToolCallChunk[];
  hasPending(): boolean;
}

interface PartialToolCall {
  id?: string;
  name?: string;
  args: string;
}

export function createToolCallAccumulator(): ToolCallAccumulator {
  const state = new Map<number, PartialToolCall>();

  return {
    absorb(delta) {
      if (!delta.tool_calls) return;
      for (const tc of delta.tool_calls) {
        const cur = state.get(tc.index) ?? { args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        state.set(tc.index, cur);
      }
    },
    flush() {
      const out: ToolCallChunk[] = [];
      const keys = [...state.keys()].sort((a, b) => a - b);
      for (const k of keys) {
        const p = state.get(k)!;
        if (!p.name) continue;
        out.push({
          type: "tool_call",
          id: p.id ?? `tc_${k}`,
          name: p.name,
          // R32 — forward the accumulated arguments JSON string verbatim
          // (default to "{}" when the model emitted no arguments). The
          // client does its own JSON.parse; we do NOT parse here.
          arguments: p.args || "{}",
        });
      }
      state.clear();
      return out;
    },
    hasPending() {
      return state.size > 0;
    },
  };
}
