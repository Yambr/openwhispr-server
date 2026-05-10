// Phase 04 / Plan 06 / Task 1 — translate-tools.ts pure helper tests.
//
// translateLegacyTools converts BACKEND_SPEC's legacy `tools` array shape
// `[{name, description, parameters}]` (the desktop's wire shape, frozen by
// spec) to OpenAI's tools shape `[{type:"function", function:{name,
// description, parameters}}]` (what LiteLLM forwards downstream). D-07.
//
// prependSystemPrompt prepends `body.systemPrompt` as a leading
// {role:"system", content} message — ADDITIVELY. Per D-11 the helper
// MUST NOT replace an existing system message; it inserts at index 0
// and lets the original system message slide to index 1.

import { describe, expect, it } from "vitest";
import { prependSystemPrompt, translateLegacyTools } from "./translate-tools.js";

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
    const out = translateLegacyTools([
      { name: "noDesc", parameters: { type: "object" } },
    ]);
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

describe("prependSystemPrompt (D-11)", () => {
  it("returns the messages array unchanged when systemPrompt is undefined", () => {
    const messages = [{ role: "user", content: "hi" }];
    expect(prependSystemPrompt(messages, undefined)).toBe(messages);
  });

  it("returns the messages array unchanged when systemPrompt is the empty string", () => {
    const messages = [{ role: "user", content: "hi" }];
    expect(prependSystemPrompt(messages, "")).toBe(messages);
  });

  it("prepends a system message when no leading system message exists", () => {
    const out = prependSystemPrompt(
      [{ role: "user", content: "hi" }],
      "be helpful",
    );
    expect(out).toEqual([
      { role: "system", content: "be helpful" },
      { role: "user", content: "hi" },
    ]);
  });

  it("ADDITIVELY prepends — never replaces an existing system message (D-11)", () => {
    const original = [
      { role: "system", content: "you are a sloth" },
      { role: "user", content: "hi" },
    ];
    const out = prependSystemPrompt(original, "be helpful");
    // The new system prompt is at index 0; the ORIGINAL system message
    // slides to index 1 (still present, never replaced).
    expect(out).toEqual([
      { role: "system", content: "be helpful" },
      { role: "system", content: "you are a sloth" },
      { role: "user", content: "hi" },
    ]);
  });
});
