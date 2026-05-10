// Phase 04 / Plan 02 / Task 1 — Pure tool-call delta accumulator.
//
// OpenAI Chat Completions streaming emits `delta.tool_calls[].function.arguments`
// as JSON-string fragments keyed by `tool_calls[].index`. Fragments must be
// concatenated by index across deltas; the consolidated args string is parsed
// only on flush (when finish_reason === "tool_calls").
//
// Safety (T-04-03 mitigation): on finish_reason === "stop" with pending state
// (LiteLLM#17246 shape), the caller MUST NOT flush — the partial tool-call
// is dropped silently. flush() is the sole state-clearing path; we expose
// no public clear() so the only way to dispose pending state is to consume it.
//
// Coverage gate: ≥90/90/90/90 — every branch is hit by the seven Plan 04-02
// behavior tests.

export interface ToolCallChunk {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
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

function parseArgsOrFallback(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return { __unparsed: raw };
  }
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
          type: "tool-call",
          toolCallId: p.id ?? `tc_${k}`,
          toolName: p.name,
          args: parseArgsOrFallback(p.args),
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
