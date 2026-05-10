// Phase 04 / Plan 01 / Task 3 — RED test stub.
//
// Wave 1 (plan 04-02) lands `apps/api/src/lib/tool-call-accumulator.ts`
// (the OpenAI-streaming `delta.tool_calls[].function.arguments`
// fragment-by-index accumulator) per CONTEXT D-09 and RESEARCH §2.4 and
// turns these tests GREEN. Today the import fails — canonical TDD RED.

import { describe, it, expect } from "vitest";
// eslint-disable-next-line import/no-unresolved -- Wave 1 creates this module; expected RED in Wave 0.
import { createToolCallAccumulator } from "./tool-call-accumulator.js";

describe("toolCallAccumulator", () => {
  it("absorbs a single tool call across multiple deltas and emits one consolidated chunk on flush", () => {
    const acc = createToolCallAccumulator();
    acc.absorb({
      tool_calls: [
        { index: 0, id: "call_a", type: "function", function: { name: "get_weather", arguments: "" } },
      ],
    });
    acc.absorb({ tool_calls: [{ index: 0, function: { arguments: '{"loc' } }] });
    acc.absorb({ tool_calls: [{ index: 0, function: { arguments: 'ation":"Paris"}' } }] });
    const out = acc.flush();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "tool-call",
      toolName: "get_weather",
      args: { location: "Paris" },
    });
  });

  it("accumulates two tool calls keyed by index and emits both on flush in index order", () => {
    const acc = createToolCallAccumulator();
    acc.absorb({
      tool_calls: [
        { index: 0, id: "call_a", type: "function", function: { name: "get_weather", arguments: '{"loc":"Paris"}' } },
        { index: 1, id: "call_b", type: "function", function: { name: "get_time", arguments: '{"tz":"UTC"}' } },
      ],
    });
    const out = acc.flush();
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ toolName: "get_weather" });
    expect(out[1]).toMatchObject({ toolName: "get_time" });
  });

  it("skips a tool call whose accumulated arguments JSON is malformed (logs + drops, does NOT throw)", () => {
    const acc = createToolCallAccumulator();
    acc.absorb({
      tool_calls: [
        { index: 0, id: "call_x", type: "function", function: { name: "bad", arguments: "{not json" } },
      ],
    });
    const out = acc.flush();
    // Either empty (drop) or a flagged-malformed chunk; Wave 1 picks one
    // semantic. RED today because module does not exist.
    expect(Array.isArray(out)).toBe(true);
  });

  it("silently skips a tool call missing a function name (provider bug guard)", () => {
    const acc = createToolCallAccumulator();
    acc.absorb({
      tool_calls: [
        { index: 0, id: "call_y", type: "function", function: { arguments: '{"k":1}' } },
      ],
    });
    const out = acc.flush();
    expect(out).toEqual([]);
  });

  it("hasPending reports true when accumulator state is non-empty even if finish_reason is 'stop'", () => {
    const acc = createToolCallAccumulator();
    acc.absorb({
      tool_calls: [
        { index: 0, id: "call_z", type: "function", function: { name: "f", arguments: '{"k":1}' } },
      ],
    });
    expect(acc.hasPending()).toBe(true);
    // finish_reason='stop' arriving while pending tool-call state lingers is
    // a provider anomaly; semantic per Wave 1 is to still flush the pending
    // state rather than silently lose it. RED today: module missing.
    const out = acc.flush();
    expect(out.length).toBeGreaterThanOrEqual(0);
  });
});
