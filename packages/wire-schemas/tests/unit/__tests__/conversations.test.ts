// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 64 / Plan 01 / Task 4 — H-3.
//
// Pins that `MetadataSchema` is exported from the conversations wire
// schema (the GREEN step adds the `export` keyword so the server can
// import the canonical schema) and enforces the bounded-key /
// scalar-value contract.

import { describe, expect, it } from "vitest";
import { MetadataSchema } from "../../../src/conversations.js";

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
});
