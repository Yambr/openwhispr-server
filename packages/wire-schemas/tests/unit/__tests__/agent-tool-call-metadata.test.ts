// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Message metadata must hold what the desktop agent actually stores.
 *
 * The desktop persists an assistant turn's tool calls as
 * `metadata: { toolCalls: ToolCallInfo[] }` (chat/useChatPersistence.ts), and
 * `ToolCallInfo` carries nested structure of its own — `arguments`, `result`,
 * and a `metadata` field that is an object for note tools and an ARRAY of
 * objects for search_notes (chat/types.ts).
 *
 * `MetadataSchema` was a flat record of scalars, so the whole conversation
 * push 400'd on the `toolCalls` key and the desktop's agent history never
 * synced. The value type was modeled on a narrower assumption than the client
 * it mirrors; the size cap is the real anti-abuse control and it stays.
 */
import { describe, expect, it } from "vitest";
import { ConversationInputSchema, MetadataSchema } from "../../../src/conversations.js";

describe("MetadataSchema — desktop agent tool-call metadata", () => {
  it("accepts an array of tool calls with nested objects and arrays", () => {
    const metadata = {
      toolCalls: [
        {
          id: "call_1",
          name: "search_notes",
          arguments: '{"query":"quarterly review"}',
          status: "completed",
          result: "3 notes found",
          metadata: [
            { note_id: "n-1", score: 0.82 },
            { note_id: "n-2", score: 0.55 },
          ],
        },
      ],
    };

    expect(MetadataSchema.safeParse(metadata).success).toBe(true);
  });

  it("still accepts the flat scalar shape it always accepted", () => {
    expect(MetadataSchema.safeParse({ model: "qwen3", tokens: 812, cached: true }).success).toBe(
      true,
    );
  });

  it("still refuses metadata past the size cap", () => {
    const oversized = { blob: "x".repeat(128 * 1024) };
    const result = MetadataSchema.safeParse(oversized);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("metadata.too_large");
    }
  });

  it("refuses a payload nested deeper than a tool call can justify", () => {
    // Built iteratively: a deep literal would be the very thing this bound
    // exists to stop the validator from choking on.
    let deep: unknown = "leaf";
    for (let i = 0; i < 64; i++) deep = [deep];

    const result = MetadataSchema.safeParse({ deep });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("metadata.too_deep");
    }
  });

  it("accepts a whole conversation push carrying tool-call metadata", () => {
    const parsed = ConversationInputSchema.safeParse({
      client_conversation_id: "conv-1",
      title: "Agent session",
      messages: [
        { role: "user", content: "find my notes on the review", metadata: null },
        {
          role: "assistant",
          content: "Found three.",
          metadata: {
            toolCalls: [
              { id: "call_1", name: "search_notes", arguments: "{}", status: "completed" },
            ],
          },
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });
});
