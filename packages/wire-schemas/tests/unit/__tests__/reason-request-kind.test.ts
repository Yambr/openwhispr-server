// SPDX-License-Identifier: FSL-1.1-ALv2
// cleanup-routing (#36) — RED→GREEN for the explicit `requestKind` field on
// ReasonRequest.
//
// CONTRACT (agreed with the desktop client + adversarial plan-check):
// `requestKind` is the PRIMARY routing class. The 4 known literals are
// "cleanup" | "agent" | "summary" | "title", but the WIRE schema bounds it
// as a plain string (max 32), NOT `z.enum([...])`. Rationale: an UNKNOWN
// value (a future 5th kind, a proxy, a partially-updated client) MUST fall
// through to the legacy shape heuristic (fail-safe) rather than 400 and
// break the dictation flow. The 4-literal narrowing is a RUNTIME concern
// owned by `isRequestKind()` in the routing layer, not the wire layer.
import { describe, expect, it } from "vitest";
import { ReasonRequest } from "../../../src/reason.js";

describe("ReasonRequest — requestKind field (cleanup-routing #36)", () => {
  it("accepts requestKind 'cleanup'", () => {
    const parsed = ReasonRequest.parse({ text: "x", requestKind: "cleanup" });
    expect(parsed.requestKind).toBe("cleanup");
  });

  it("accepts requestKind 'agent' | 'summary' | 'title'", () => {
    for (const kind of ["agent", "summary", "title"] as const) {
      const parsed = ReasonRequest.parse({ text: "x", requestKind: kind });
      expect(parsed.requestKind).toBe(kind);
    }
  });

  it("accepts an UNKNOWN requestKind string WITHOUT 400 (fail-safe, not z.enum)", () => {
    // The load-bearing assertion proving the bounded-string (not z.enum)
    // decision: a garbage/future value must parse and round-trip so the
    // routing layer can treat it as "absent" → fallback.
    const parsed = ReasonRequest.parse({ text: "x", requestKind: "chatbot" });
    expect(parsed.requestKind).toBe("chatbot");
  });

  it("accepts requestKind null (nullish sibling convention)", () => {
    const parsed = ReasonRequest.parse({ text: "x", requestKind: null });
    expect(parsed.requestKind).toBeNull();
  });

  it("accepts requestKind absent", () => {
    const parsed = ReasonRequest.parse({ text: "x" });
    expect(parsed.requestKind).toBeUndefined();
  });

  it("400s on requestKind over 32 chars (bound)", () => {
    expect(ReasonRequest.safeParse({ text: "x", requestKind: "a".repeat(33) }).success).toBe(false);
  });

  it("400s on requestKind non-string (number)", () => {
    expect(ReasonRequest.safeParse({ text: "x", requestKind: 7 }).success).toBe(false);
  });
});
