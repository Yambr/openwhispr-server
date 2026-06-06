// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-07 — RED→GREEN regressions for REVIEW-INDEX.md
// CR-11 + 4 HIGH from wire-schemas review.
//
// Five concrete defects:
//   * reason.ts — `text.min(1)` without `.max()` → cost-multiplier DOS
//     when forwarded verbatim to LiteLLM. Phase 41.b fixed the same
//     shape for `/api/agent/stream`; the `/api/reason` schema was
//     missed.
//   * reason.ts — provider / promptMode / matchType / model are
//     unconstrained `z.string()` though the wire contract pins them to
//     a small enum surface. The handler echoes the values back into
//     the response verbatim, so a client can poison documented wire
//     fields.
//   * delete-account.ts — `z.object({}).passthrough()` accepts literally
//     any object, defeating the purpose of having a wire schema.
//   * check-user.ts + verification-status.ts — email lacks `.max()` on
//     an unauthenticated probe endpoint (DoS via multi-MB email DB
//     lookup).

import { describe, expect, it } from "vitest";
import { CheckUserRequest } from "../../../src/check-user.js";
import { DeleteAccountResponse } from "../../../src/delete-account.js";
import { ReasonRequest } from "../../../src/reason.js";
import { VerificationStatusQuery } from "../../../src/verification-status.js";

describe("Plan 51-07 — wire-schemas hardening", () => {
  describe("reason.ts (CR-11)", () => {
    it("rejects unbounded text (DoS via cost-multiplier on LiteLLM)", () => {
      const huge = "x".repeat(1_000_000);
      const r = ReasonRequest.safeParse({ text: huge });
      expect(r.success).toBe(false);
    });

    it("rejects empty text", () => {
      const r = ReasonRequest.safeParse({ text: "" });
      expect(r.success).toBe(false);
    });

    it("accepts a normal-sized prompt", () => {
      const r = ReasonRequest.safeParse({ text: "Why is the sky blue?" });
      expect(r.success).toBe(true);
    });

    // R23: provider / promptMode / matchType were RESPONSE-shape fields
    // wrongly modeled on the REQUEST schema. They are removed from
    // ReasonRequest. The schema is now `.passthrough()`, so a stray
    // value for any of them is tolerated (accepted, ignored) rather than
    // rejected — the route never reads them from the request body.
    it("R23 — tolerates a stray `provider` (removed from request schema, .passthrough())", () => {
      const r = ReasonRequest.safeParse({ text: "ok", provider: "evil" });
      expect(r.success).toBe(true);
    });

    it("R23 — tolerates a stray `promptMode` (removed from request schema, .passthrough())", () => {
      const r = ReasonRequest.safeParse({ text: "ok", promptMode: "junk" });
      expect(r.success).toBe(true);
    });

    it("R23 — tolerates a stray `matchType` (removed from request schema, .passthrough())", () => {
      const r = ReasonRequest.safeParse({ text: "ok", matchType: "junk" });
      expect(r.success).toBe(true);
    });
  });

  describe("delete-account.ts", () => {
    it("rejects arbitrary extra keys (no longer .passthrough())", () => {
      const r = DeleteAccountResponse.safeParse({ malicious: "payload" });
      expect(r.success).toBe(false);
    });

    it("accepts the empty object", () => {
      const r = DeleteAccountResponse.safeParse({});
      expect(r.success).toBe(true);
    });
  });

  describe("check-user.ts + verification-status.ts (unauthenticated probe surfaces)", () => {
    it("check-user rejects emails > 254 bytes (RFC 5321 floor)", () => {
      const huge = `${"x".repeat(255)}@example.com`;
      const r = CheckUserRequest.safeParse({ email: huge });
      expect(r.success).toBe(false);
    });

    it("verification-status rejects emails > 254 bytes", () => {
      const huge = `${"x".repeat(255)}@example.com`;
      const r = VerificationStatusQuery.safeParse({ email: huge });
      expect(r.success).toBe(false);
    });

    it("check-user accepts a normal email", () => {
      const r = CheckUserRequest.safeParse({ email: "u@example.com" });
      expect(r.success).toBe(true);
    });

    it("verification-status accepts a normal email", () => {
      const r = VerificationStatusQuery.safeParse({ email: "u@example.com" });
      expect(r.success).toBe(true);
    });

    // Phase 59 / Track D — R15/R5: `?email=` is OPTIONAL. R5 requires the
    // server to accept the param "without warning, without error" — which
    // includes its absence. A required-param schema (the inverse of R5)
    // 400s a desktop poll that omits the param.
    it("R15/R5: verification-status accepts an absent email (param optional)", () => {
      const r = VerificationStatusQuery.safeParse({});
      expect(r.success).toBe(true);
    });

    it("R15/R5: verification-status still rejects a malformed email when present", () => {
      const r = VerificationStatusQuery.safeParse({ email: "not-an-email" });
      expect(r.success).toBe(false);
    });
  });
});
