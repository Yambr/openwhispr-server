// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 04 / Plan 06 / Task 1 — translate-tools.ts pure helper tests.
//
// translateLegacyTools converts BACKEND_SPEC's legacy `tools` array shape
// `[{name, description, parameters}]` (the desktop's wire shape, frozen by
// spec) to OpenAI's tools shape `[{type:"function", function:{name,
// description, parameters}}]` (what LiteLLM forwards downstream). D-07.
//
// normalizeSystemMessages (upstream-#14) normalizes the messages array to
// EXACTLY ONE system message at index [0], merging+deduping all system
// content (the optional `body.systemPrompt` first, then each in-array system
// message in order) and preserving the relative order of every non-system
// message. D-11's additive prepend is SUPERSEDED: the gateway's strict chat
// template (qwen-class model) rejects >1 leading system message.

import { describe, expect, it } from "vitest";
import {
  normalizeSystemMessages,
  translateLegacyTools,
} from "../../../../src/routes/agent/translate-tools.js";

describe("translateLegacyTools (D-07)", () => {
  it("returns undefined when input is undefined", () => {
    expect(translateLegacyTools(undefined)).toBeUndefined();
  });

  it("returns an empty array when input is an empty array", () => {
    expect(translateLegacyTools([])).toEqual([]);
  });

  it("translates a single legacy tool to the OpenAI tools shape", () => {
    const out = translateLegacyTools([
      {
        name: "search",
        description: "Search the web",
        parameters: { type: "object", properties: { q: { type: "string" } } },
      },
    ]);
    expect(out).toEqual([
      {
        type: "function",
        function: {
          name: "search",
          description: "Search the web",
          parameters: { type: "object", properties: { q: { type: "string" } } },
        },
      },
    ]);
  });

  it("preserves the order of multiple tools", () => {
    const out = translateLegacyTools([
      { name: "a", description: "A", parameters: {} },
      { name: "b", description: "B", parameters: {} },
      { name: "c", description: "C", parameters: {} },
    ]);
    expect(out?.map((t) => t.function.name)).toEqual(["a", "b", "c"]);
  });

  it("tolerates a missing description (translated as undefined)", () => {
    const out = translateLegacyTools([{ name: "noDesc", parameters: { type: "object" } }]);
    expect(out).toEqual([
      {
        type: "function",
        function: {
          name: "noDesc",
          description: undefined,
          parameters: { type: "object" },
        },
      },
    ]);
  });
});

describe("normalizeSystemMessages (upstream-#14, strict single system)", () => {
  // Helper: assert there is at most ONE system message and it is at index [0].
  const countSystems = (arr: { role: string }[]): number =>
    arr.filter((m) => m.role === "system").length;

  it("case 6 — no systemPrompt, no system message: array unchanged", () => {
    const messages = [{ role: "user", content: "hi" }];
    const out = normalizeSystemMessages(messages, undefined);
    expect(out).toEqual([{ role: "user", content: "hi" }]);
    expect(countSystems(out)).toBe(0);
  });

  it("empty/falsy systemPrompt is treated as unset — no {system,''} injected", () => {
    const messages = [{ role: "user", content: "hi" }];
    const out = normalizeSystemMessages(messages, "");
    expect(out).toEqual([{ role: "user", content: "hi" }]);
    expect(countSystems(out)).toBe(0);
  });

  it("case 3 — systemPrompt set, no system in messages: prepends single system", () => {
    const out = normalizeSystemMessages([{ role: "user", content: "hi" }], "be helpful");
    expect(out).toEqual([
      { role: "system", content: "be helpful" },
      { role: "user", content: "hi" },
    ]);
    expect(countSystems(out)).toBe(1);
  });

  it("case 4 — no systemPrompt, leading system: passes through (already single)", () => {
    const out = normalizeSystemMessages(
      [
        { role: "system", content: "S" },
        { role: "user", content: "hi" },
      ],
      undefined,
    );
    expect(out).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: "hi" },
    ]);
    expect(countSystems(out)).toBe(1);
    expect(out[0]?.role).toBe("system");
  });

  it("case 1 — byte-identical dup (THIS CLIENT'S BODY): collapses to ONE system 'P', NOT 'P\\n\\nP'", () => {
    const out = normalizeSystemMessages(
      [
        { role: "system", content: "P" },
        { role: "user", content: "hi" },
      ],
      "P",
    );
    expect(out).toEqual([
      { role: "system", content: "P" },
      { role: "user", content: "hi" },
    ]);
    expect(out[0]?.content).toBe("P");
    expect(out[0]?.content).not.toBe("P\n\nP");
    expect(countSystems(out)).toBe(1);
  });

  it("case 2 — systemPrompt + DIFFERENT leading system: merges 'A\\n\\nB' as single system", () => {
    const out = normalizeSystemMessages(
      [
        { role: "system", content: "you are a sloth" },
        { role: "user", content: "hi" },
      ],
      "be helpful",
    );
    expect(out).toEqual([
      { role: "system", content: "be helpful\n\nyou are a sloth" },
      { role: "user", content: "hi" },
    ]);
    expect(countSystems(out)).toBe(1);
  });

  it("case 5 — system at index>0 (mid-array, multiple): folds to single [0], non-system order preserved", () => {
    const out = normalizeSystemMessages(
      [
        { role: "user", content: "a" },
        { role: "system", content: "X" },
        { role: "assistant", content: "b" },
        { role: "system", content: "Y" },
        { role: "user", content: "c" },
      ],
      undefined,
    );
    expect(out).toEqual([
      { role: "system", content: "X\n\nY" },
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ]);
    expect(countSystems(out)).toBe(1);
    expect(out[0]?.role).toBe("system");
    expect(out.filter((m) => m.role !== "system").map((m) => m.content)).toEqual(["a", "b", "c"]);
  });

  it("case 5 dedup — byte-identical mid-array systems collapse to single 'X'", () => {
    const out = normalizeSystemMessages(
      [
        { role: "system", content: "X" },
        { role: "user", content: "a" },
        { role: "system", content: "X" },
      ],
      undefined,
    );
    expect(out).toEqual([
      { role: "system", content: "X" },
      { role: "user", content: "a" },
    ]);
    expect(out[0]?.content).toBe("X");
    expect(out[0]?.content).not.toBe("X\n\nX");
    expect(countSystems(out)).toBe(1);
  });

  it("history order — byte-identical systemPrompt keeps the user/assistant/user tail in exact order", () => {
    const out = normalizeSystemMessages(
      [
        { role: "system", content: "S" },
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "u2" },
      ],
      "S",
    );
    expect(out).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ]);
    expect(countSystems(out)).toBe(1);
    expect(out.filter((m) => m.role !== "system").map((m) => m.content)).toEqual([
      "u1",
      "a1",
      "u2",
    ]);
  });

  it("non-string content guard — object system content does not crash, included as-is fragment", () => {
    const out = normalizeSystemMessages(
      [
        { role: "system", content: { nested: true } },
        { role: "user", content: "hi" },
      ],
      undefined,
    );
    expect(countSystems(out)).toBe(1);
    expect(out[0]?.role).toBe("system");
    expect(out[0]?.content).toEqual({ nested: true });
    expect(out[1]).toEqual({ role: "user", content: "hi" });
  });

  it("non-string guard with multiple fragments — string + object merge, object rendered, no crash", () => {
    const out = normalizeSystemMessages(
      [
        { role: "system", content: "A" },
        { role: "user", content: "hi" },
        { role: "system", content: { nested: true } },
      ],
      undefined,
    );
    expect(countSystems(out)).toBe(1);
    expect(out[0]?.role).toBe("system");
    // String fragment first, then the JSON-rendered object fragment, joined
    // with "\n\n" — nothing dropped (D-11 no-content-loss intent).
    expect(out[0]?.content).toBe('A\n\n{"nested":true}');
    expect(out[1]).toEqual({ role: "user", content: "hi" });
  });
});
