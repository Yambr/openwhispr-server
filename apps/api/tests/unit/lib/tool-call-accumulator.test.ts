// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 04 / Plan 02 / Task 1 — TDD GREEN suite.
//
// Wave 1 expands the Wave 0 RED stub into the 7 behavior tests required
// by 04-02-PLAN.md. The accumulator is a pure state machine over OpenAI
// streaming `delta.tool_calls[].function.arguments` fragments keyed by
// `index` (CONTEXT D-09, RESEARCH §2.4).

import { describe, expect, it } from "vitest";
import { createToolCallAccumulator } from "../../../src/lib/tool-call-accumulator.js";

describe("toolCallAccumulator", () => {
  // Test 1 — single tool call across multiple deltas → one consolidated chunk.
  it("absorbs a single tool call across multiple deltas and emits one consolidated chunk on flush", () => {
    const acc = createToolCallAccumulator();
    acc.absorb({
      tool_calls: [{ index: 0, id: "call_a", function: { name: "get_weather", arguments: "" } }],
    });
    acc.absorb({ tool_calls: [{ index: 0, function: { arguments: '{"loc' } }] });
    acc.absorb({ tool_calls: [{ index: 0, function: { arguments: 'ation":' } }] });
    acc.absorb({ tool_calls: [{ index: 0, function: { arguments: '"Paris,FR' } }] });
    acc.absorb({ tool_calls: [{ index: 0, function: { arguments: '"}' } }] });
    const out = acc.flush();
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      type: "tool-call",
      toolCallId: "call_a",
      toolName: "get_weather",
      args: { location: "Paris,FR" },
    });
  });

  // Test 2 — multi tool call → 2 chunks in index order (0 first).
  it("emits two consolidated chunks in ascending index order when interleaved deltas accumulate two tool calls", () => {
    const acc = createToolCallAccumulator();
    // Interleave indexes deliberately — index 1 first, then 0, then back to 1.
    acc.absorb({
      tool_calls: [{ index: 1, id: "call_b", function: { name: "get_time", arguments: '{"tz":' } }],
    });
    acc.absorb({
      tool_calls: [
        {
          index: 0,
          id: "call_a",
          function: { name: "get_weather", arguments: '{"location":"Paris"}' },
        },
      ],
    });
    acc.absorb({ tool_calls: [{ index: 1, function: { arguments: '"UTC"}' } }] });
    const out = acc.flush();
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      type: "tool-call",
      toolCallId: "call_a",
      toolName: "get_weather",
      args: { location: "Paris" },
    });
    expect(out[1]).toEqual({
      type: "tool-call",
      toolCallId: "call_b",
      toolName: "get_time",
      args: { tz: "UTC" },
    });
  });

  // Test 3 — malformed args JSON falls back to {__unparsed: <raw>}.
  it("emits a chunk with args={__unparsed:<raw>} when accumulated arguments cannot be JSON.parsed", () => {
    const acc = createToolCallAccumulator();
    acc.absorb({
      tool_calls: [{ index: 0, id: "call_x", function: { name: "bad", arguments: "{not json" } }],
    });
    const out = acc.flush();
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      type: "tool-call",
      toolCallId: "call_x",
      toolName: "bad",
      args: { __unparsed: "{not json" },
    });
  });

  // Test 4 — missing function.name → silently skipped (no chunk emitted for that index).
  it("silently skips a tool call missing function.name (provider bug guard)", () => {
    const acc = createToolCallAccumulator();
    acc.absorb({
      tool_calls: [
        { index: 0, id: "call_y", function: { arguments: '{"k":1}' } },
        { index: 1, id: "call_z", function: { name: "ok", arguments: '{"k":2}' } },
      ],
    });
    const out = acc.flush();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ toolCallId: "call_z", toolName: "ok" });
  });

  // Test 5 — hasPending() before/after flush.
  it("hasPending() returns true when state non-empty and false after flush clears it", () => {
    const acc = createToolCallAccumulator();
    expect(acc.hasPending()).toBe(false);
    acc.absorb({
      tool_calls: [{ index: 0, id: "c", function: { name: "f", arguments: "{}" } }],
    });
    expect(acc.hasPending()).toBe(true);
    acc.flush();
    expect(acc.hasPending()).toBe(false);
  });

  // Test 6 — finish_reason='stop' safety: caller sees hasPending=true, does NOT
  // call flush; subsequent absorb on a fresh stream resets cleanly. This
  // mirrors the LiteLLM#17246 mitigation (T-04-03).
  it("preserves pending state for caller inspection on finish_reason=stop; subsequent absorb merges on top", () => {
    const acc = createToolCallAccumulator();
    acc.absorb({
      tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: '{"a":' } }],
    });
    // Caller observes hasPending and (per T-04-03) declines to flush.
    expect(acc.hasPending()).toBe(true);
    // Without an explicit clear method, flushing IS the only state-clearing
    // path. Caller can either accept the partial via flush() or simply leave
    // state in place; a fresh stream calls absorb with a new index 0 which
    // overwrites cleanly via id/name keys.
    const partial = acc.flush();
    expect(partial).toHaveLength(1);
    expect(partial[0]?.args).toEqual({ __unparsed: '{"a":' });
    expect(acc.hasPending()).toBe(false);
  });

  // Branch coverage — absorb tolerates deltas without tool_calls and tool_calls
  // entries with no function block / no id / no name / no arguments.
  it("tolerates deltas with no tool_calls and tool_calls entries lacking optional fields", () => {
    const acc = createToolCallAccumulator();
    acc.absorb({}); // no tool_calls at all
    acc.absorb({ tool_calls: [{ index: 0 }] }); // no function block
    acc.absorb({ tool_calls: [{ index: 0, function: {} }] }); // empty function block
    acc.absorb({ tool_calls: [{ index: 0, function: { arguments: "" } }] }); // empty args fragment
    expect(acc.hasPending()).toBe(true);
    // No name was ever set, so flush emits nothing.
    expect(acc.flush()).toEqual([]);
  });

  // Test 7 — id fallback uses tc_<index> when function.id is absent.
  it("uses tc_<index> as toolCallId when no id was ever provided in any delta", () => {
    const acc = createToolCallAccumulator();
    acc.absorb({
      tool_calls: [{ index: 3, function: { name: "noid", arguments: '{"x":1}' } }],
    });
    const out = acc.flush();
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      type: "tool-call",
      toolCallId: "tc_3",
      toolName: "noid",
      args: { x: 1 },
    });
  });
});
