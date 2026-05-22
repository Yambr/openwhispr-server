// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 64 / Plan 01 / Task 4 — H-3.
//
// Pins that `MetadataSchema` is exported from the conversations wire
// schema (the GREEN step adds the `export` keyword so the server can
// import the canonical schema) and enforces the bounded-key /
// scalar-value contract.

import { describe, expect, it } from "vitest";
import { ConversationInputSchema, MetadataSchema } from "../../../src/conversations.js";

describe("H-3 — conversations MetadataSchema", () => {
  it("MetadataSchema is exported and parses a flat scalar map", () => {
    expect(MetadataSchema).toBeDefined();
    expect(() => MetadataSchema.parse({ source: "desktop", count: 3, pinned: true })).not.toThrow();
  });

  it("rejects a nested-object value", () => {
    expect(() => MetadataSchema.parse({ evil: { nested: true } })).toThrow();
  });

  it("rejects an array value", () => {
    expect(() => MetadataSchema.parse({ list: [1, 2, 3] })).toThrow();
  });

  it("rejects a key longer than 64 chars", () => {
    expect(() => MetadataSchema.parse({ ["k".repeat(65)]: "v" })).toThrow();
  });

  it("rejects a metadata object exceeding the 4 KiB stringified cap", () => {
    const huge = { big: "x".repeat(5000) };
    expect(() => MetadataSchema.parse(huge)).toThrow();
  });

  // Phase 68 / Plan 68-01 — REVIEW wire-schemas HIGH H-1.
  // The size-refinement message must NOT carry an inline English
  // end-user string ("metadata too large") — it must be a stable
  // machine key the route localizes via i18next.
  it("H-1: the size-refinement issue message is the machine key metadata.too_large", () => {
    const huge = { big: "x".repeat(5000) };
    const result = MetadataSchema.safeParse(huge);
    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = result.error.issues.map((i) => i.message);
    expect(messages).toContain("metadata.too_large");
    expect(messages).not.toContain("metadata too large");
  });
});

describe("R36 — ConversationInput message.metadata accepts explicit null", () => {
  // The immutable desktop client's SyncService.pushConversation maps
  // every message as `metadata: m.metadata ? (...) : null` — a message
  // without metadata carries an EXPLICIT `null`. Practically every
  // conversation has at least one such message, so the input schema
  // MUST accept `metadata: null` (R28 class — `.optional()` alone
  // rejects an explicit null).
  it("accepts a message with metadata:null", () => {
    const result = ConversationInputSchema.safeParse({
      messages: [{ role: "user", content: "hi", metadata: null }],
    });
    expect(result.success).toBe(true);
  });

  it("still accepts a message with metadata absent", () => {
    const result = ConversationInputSchema.safeParse({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.success).toBe(true);
  });

  it("still accepts a message with a populated metadata object", () => {
    const result = ConversationInputSchema.safeParse({
      messages: [{ role: "user", content: "hi", metadata: { k: "v" } }],
    });
    expect(result.success).toBe(true);
  });
});
