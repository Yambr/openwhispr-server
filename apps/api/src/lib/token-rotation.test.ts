// Phase 2 / Plan 01 / Task 1 — RED tests for the SHA-256 token-hash helper.
// Only the pure cryptographic function is covered here; the DB-touching
// helpers (recordPreviousToken / tryPreviousToken) live in a follow-up task
// because they require a live appDb + tenant context.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashToken } from "./token-rotation.js";

describe("hashToken", () => {
  it("returns a 32-byte Buffer", () => {
    const out = hashToken("any-token");
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBe(32);
  });

  it("is deterministic — same input produces same output", () => {
    const a = hashToken("abc123");
    const b = hashToken("abc123");
    expect(a.equals(b)).toBe(true);
  });

  it("produces different output for different inputs", () => {
    const a = hashToken("abc123");
    const b = hashToken("abc124");
    expect(a.equals(b)).toBe(false);
  });

  it("matches a fresh sha256 against the same input", () => {
    const reference = createHash("sha256").update("token-of-interest").digest();
    expect(hashToken("token-of-interest").equals(reference)).toBe(true);
  });

  it("handles empty strings without throwing (sha256 has a defined empty-input output)", () => {
    const out = hashToken("");
    expect(out.length).toBe(32);
  });
});
