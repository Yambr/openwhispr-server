// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 64 / Plan 01 / Task 4 — H-3 (wire-schema metadata-shape drift).
//
// Finding: server `MessageInputSchema.metadata` was
// `z.record(z.string(), z.unknown())` — it accepted nested
// objects/arrays the canonical `MetadataSchema` (bounded keys, scalar
// values, 4 KiB cap) rejects. A client could persist a metadata shape
// the desktop's round-trip parse later rejects.
//
// Fix: the server adopts the canonical `MetadataSchema` from
// `@openwhispr/wire-schemas` (which Task 4's GREEN also `export`s).
//
// The route-level acceptance case moved to
// __tests__/messages.integration.test.ts, where a real conversation exists to
// POST against; this file keeps the schema-shape assertions it is named for.

import { MetadataSchema } from "@openwhispr/wire-schemas";
import { describe, expect, it } from "vitest";

describe("H-3 — conversations message metadata vs canonical contract", () => {
  it("H-3 — canonical MetadataSchema parses flat scalars and bounded nesting", () => {
    // MetadataSchema must be exported from @openwhispr/wire-schemas
    // (the GREEN step adds the `export` keyword). This import doubles as
    // the export-needed RED signal.
    expect(() => MetadataSchema.parse({ a: "string", b: 42, c: true })).not.toThrow();
    expect(() => MetadataSchema.parse({ toolCalls: [{ id: "call_1" }] })).not.toThrow();
    let deep: unknown = "leaf";
    for (let i = 0; i < 64; i++) deep = [deep];
    expect(() => MetadataSchema.parse({ deep })).toThrow();
  });
});
