// SPDX-License-Identifier: FSL-1.1-ALv2
// R28 (quick-task 20260522) — RED→GREEN regression for the schema
// rejecting JSON `null` on optional fields.
//
// The immutable desktop client builds the /api/reason + /api/agent/stream
// body from `opts.model` / `opts.agentName` etc.; on the FIRST dictation
// of a session those are `null`, so the body literally contains
// `"model":null`. Zod's `.optional()` accepts "key absent" OR the typed
// value — but NOT `null` — so the server 400s the first dictation.
// `null` for an unset optional field is valid JSON and standard client
// behavior; the fix widens every optional field to `.nullish()`.
import { describe, expect, it } from "vitest";
import { AgentLegacyToolSchema, AgentStreamRequestSchema } from "../../../src/agent.js";
import { ReasonRequest } from "../../../src/reason.js";

describe("R28 — ReasonRequest tolerates `null` on optional fields", () => {
  it("accepts {text, model:null} (first-dictation body)", () => {
    expect(ReasonRequest.safeParse({ text: "hi", model: null }).success).toBe(true);
  });

  it("accepts {text, agentName:null} (first-dictation body)", () => {
    expect(ReasonRequest.safeParse({ text: "hi", agentName: null }).success).toBe(true);
  });

  it("accepts a body with EVERY optional field explicitly null", () => {
    const r = ReasonRequest.safeParse({
      text: "hi",
      model: null,
      agentName: null,
      customDictionary: null,
      customPrompt: null,
      systemPrompt: null,
      language: null,
      locale: null,
      sessionId: null,
      clientType: null,
      appVersion: null,
      clientVersion: null,
      sttProvider: null,
      sttModel: null,
      sttLanguage: null,
      audioFormat: null,
      sttProcessingMs: null,
      sttWordCount: null,
      audioDurationMs: null,
      audioSizeBytes: null,
      clientTotalMs: null,
    });
    expect(r.success).toBe(true);
  });

  it("still accepts the key-absent body (regression — no behavior change)", () => {
    expect(ReasonRequest.safeParse({ text: "hi" }).success).toBe(true);
  });

  it("still accepts a typed value when present", () => {
    expect(
      ReasonRequest.safeParse({ text: "hi", model: "qwen3.6-plus", sttWordCount: 12 }).success,
    ).toBe(true);
  });

  it("still rejects empty text (required min(1) unaffected by widening)", () => {
    expect(ReasonRequest.safeParse({ text: "" }).success).toBe(false);
  });

  it("still rejects a non-string non-null model (42)", () => {
    expect(ReasonRequest.safeParse({ text: "hi", model: 42 }).success).toBe(false);
  });

  it("still rejects an oversize model string (max bound holds when value present)", () => {
    expect(ReasonRequest.safeParse({ text: "hi", model: "x".repeat(129) }).success).toBe(false);
  });
});

describe("R28 — AgentStreamRequestSchema tolerates `null` on optional fields", () => {
  it("accepts {messages, model:null} (first-dictation body)", () => {
    expect(
      AgentStreamRequestSchema.safeParse({
        messages: [{ role: "user", content: "hi" }],
        model: null,
      }).success,
    ).toBe(true);
  });

  it("accepts {messages, tools:null}", () => {
    expect(
      AgentStreamRequestSchema.safeParse({
        messages: [{ role: "user", content: "hi" }],
        tools: null,
      }).success,
    ).toBe(true);
  });

  it("accepts a body with every optional field explicitly null", () => {
    const r = AgentStreamRequestSchema.safeParse({
      messages: [{ role: "user", content: "hi" }],
      model: null,
      systemPrompt: null,
      tools: null,
      sessionId: null,
      clientType: null,
      appVersion: null,
    });
    expect(r.success).toBe(true);
  });

  it("still rejects missing messages (required unaffected)", () => {
    expect(AgentStreamRequestSchema.safeParse({}).success).toBe(false);
  });

  it("still rejects a non-string non-null model (42)", () => {
    expect(AgentStreamRequestSchema.safeParse({ messages: [], model: 42 }).success).toBe(false);
  });
});

describe("R28 — AgentLegacyToolSchema.description tolerates `null`", () => {
  it("accepts a tool with description:null", () => {
    expect(
      AgentLegacyToolSchema.safeParse({ name: "search", description: null, parameters: {} })
        .success,
    ).toBe(true);
  });

  it("accepts a tool with a string description (regression)", () => {
    expect(
      AgentLegacyToolSchema.safeParse({ name: "search", description: "web", parameters: {} })
        .success,
    ).toBe(true);
  });

  it("accepts AgentStreamRequest with a tool whose description is null", () => {
    expect(
      AgentStreamRequestSchema.safeParse({
        messages: [{ role: "user", content: "x" }],
        tools: [{ name: "search", description: null, parameters: {} }],
      }).success,
    ).toBe(true);
  });
});
