// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 41.b / HI-02 — wire-schema tests for AgentStreamRequest.
 * RED → GREEN pair for the new strict body schema (validation gap
 * closed in apps/api/src/routes/agent/stream.ts).
 */
import { describe, expect, it } from "vitest";
import {
  AgentChatMessageSchema,
  AgentLegacyToolSchema,
  AgentStreamRequestSchema,
} from "../../../src/agent.js";

describe("AgentStreamRequestSchema", () => {
  it("accepts the canonical minimal payload (single user message)", () => {
    const r = AgentStreamRequestSchema.safeParse({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts an empty messages array (boundary; route still issues upstream)", () => {
    expect(AgentStreamRequestSchema.safeParse({ messages: [] }).success).toBe(true);
  });

  it("accepts model + systemPrompt + tools combined", () => {
    expect(
      AgentStreamRequestSchema.safeParse({
        messages: [{ role: "user", content: "go" }],
        model: "qwen3.6-plus",
        systemPrompt: "be helpful",
        tools: [{ name: "search", description: "web", parameters: { type: "object" } }],
      }).success,
    ).toBe(true);
  });

  // The agent tool loop appends TWO messages per tool call (the assistant's
  // tool-call turn and the result), so the cap is spent twice as fast as the
  // number of calls. At 50 it was reachable by ordinary work: a desktop session
  // that ran 24 tool calls sent 48 + 3 conversational = 51 messages and got a
  // 400 "Invalid request" mid-task — the agent had already searched and read
  // two dozen notes and simply stopped. 256 sits far above anything the client
  // can produce on its own (MAX_TOOL_STEPS = 20), so the ceiling is the
  // client's, not ours, and the real abuse control is the body-size limit.
  it("accepts a long tool-loop conversation (256 messages)", () => {
    const messages = Array.from({ length: 256 }, (_, i) => ({
      role: i % 2 === 0 ? "assistant" : "tool",
      content: "x",
    }));
    expect(AgentStreamRequestSchema.safeParse({ messages }).success).toBe(true);
  });

  it("still refuses a conversation past the cap", () => {
    const messages = Array.from({ length: 257 }, () => ({ role: "user", content: "x" }));
    expect(AgentStreamRequestSchema.safeParse({ messages }).success).toBe(false);
  });

  it("rejects missing messages field (required)", () => {
    expect(AgentStreamRequestSchema.safeParse({}).success).toBe(false);
  });

  it("R23 — accepts unknown top-level keys (.passthrough() forward-compat)", () => {
    expect(
      AgentStreamRequestSchema.safeParse({
        messages: [{ role: "user", content: "x" }],
        futureClientField: "value",
      }).success,
    ).toBe(true);
  });

  it("R23 — accepts the documented sessionId / clientType / appVersion fields", () => {
    expect(
      AgentStreamRequestSchema.safeParse({
        messages: [{ role: "user", content: "x" }],
        sessionId: "11111111-2222-3333-4444-555555555555",
        clientType: "desktop",
        appVersion: "1.2.3",
      }).success,
    ).toBe(true);
  });

  it("R23 — rejects oversize sessionId / clientType / appVersion (max bound)", () => {
    const long = "x".repeat(257);
    expect(AgentStreamRequestSchema.safeParse({ messages: [], sessionId: long }).success).toBe(
      false,
    );
    expect(AgentStreamRequestSchema.safeParse({ messages: [], clientType: long }).success).toBe(
      false,
    );
    expect(AgentStreamRequestSchema.safeParse({ messages: [], appVersion: long }).success).toBe(
      false,
    );
  });

  it("rejects tools.length > 64", () => {
    const tools = Array.from({ length: 65 }, (_, i) => ({
      name: `t${i}`,
      parameters: {},
    }));
    expect(AgentStreamRequestSchema.safeParse({ messages: [], tools }).success).toBe(false);
  });

  it("rejects oversize systemPrompt (> 16_384 chars)", () => {
    const systemPrompt = "x".repeat(16_385);
    expect(AgentStreamRequestSchema.safeParse({ messages: [], systemPrompt }).success).toBe(false);
  });

  it("rejects empty model string (min 1)", () => {
    expect(AgentStreamRequestSchema.safeParse({ messages: [], model: "" }).success).toBe(false);
  });

  it("rejects oversize model name (> 128 chars)", () => {
    expect(
      AgentStreamRequestSchema.safeParse({ messages: [], model: "x".repeat(129) }).success,
    ).toBe(false);
  });

  it("rejects a non-string tool name (cast-bypass class)", () => {
    expect(
      AgentStreamRequestSchema.safeParse({
        messages: [],
        tools: [{ name: 42, parameters: {} } as unknown as { name: string; parameters: unknown }],
      }).success,
    ).toBe(false);
  });

  it("rejects a string tools field (the very class HI-02 was opened to catch)", () => {
    expect(
      AgentStreamRequestSchema.safeParse({
        messages: [{ role: "user", content: "x" }],
        tools: "abc" as unknown as Array<unknown>,
      }).success,
    ).toBe(false);
  });
});

describe("AgentChatMessageSchema", () => {
  it("requires non-empty role", () => {
    expect(AgentChatMessageSchema.safeParse({ role: "", content: "x" }).success).toBe(false);
  });

  it("accepts unknown content shape (multi-modal pass-through)", () => {
    expect(
      AgentChatMessageSchema.safeParse({ role: "user", content: [{ type: "text", text: "hi" }] })
        .success,
    ).toBe(true);
  });

  it("rejects unknown keys (strict)", () => {
    expect(AgentChatMessageSchema.safeParse({ role: "user", content: "x", extra: 1 }).success).toBe(
      false,
    );
  });
});

describe("AgentLegacyToolSchema", () => {
  it("accepts the minimal name + parameters shape", () => {
    expect(AgentLegacyToolSchema.safeParse({ name: "search", parameters: {} }).success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(AgentLegacyToolSchema.safeParse({ name: "", parameters: {} }).success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    expect(
      AgentLegacyToolSchema.safeParse({
        name: "x",
        parameters: {},
        extra: 1,
      }).success,
    ).toBe(false);
  });
});
