// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 09 / Task 1 — argon2-keys helper unit tests.
//
// Exercises real Argon2id (no boundary mocks — this is in-process crypto
// per CLAUDE.md "No mocks of internal logic"). Verifies OWASP 2026
// parameters embedded in the hash format string, non-blocking concurrent
// verification (Pitfall #5), and the pak_/prefix invariants.

import { describe, expect, it } from "vitest";
import {
  generatePak,
  hashKey,
  parsePakPrefix,
  verifyKey,
} from "../../../../src/lib/argon2-keys.js";

describe("argon2-keys — generatePak()", () => {
  it("returns clearText starting with 'pak_' and length ~36", () => {
    const { clearText } = generatePak();
    expect(clearText.startsWith("pak_")).toBe(true);
    // randomBytes(24) base64url → 32 chars, plus `pak_` literal = 36.
    expect(clearText.length).toBe(36);
  });

  it("returns prefix of exactly 12 chars matching clearText.slice(0, 12)", () => {
    const { clearText, prefix } = generatePak();
    expect(prefix.length).toBe(12);
    expect(prefix).toBe(clearText.slice(0, 12));
    expect(prefix.startsWith("pak_")).toBe(true);
  });

  it("emits unique clearText on consecutive calls (entropy check)", () => {
    const set = new Set<string>();
    for (let i = 0; i < 50; i++) {
      set.add(generatePak().clearText);
    }
    expect(set.size).toBe(50);
  });
});

describe("argon2-keys — hashKey() / verifyKey()", () => {
  it("hashKey() emits OWASP 2026 Argon2id format string ($argon2id$v=19$m=65536,t=3,p=1$…)", async () => {
    const { clearText } = generatePak();
    const stored = await hashKey(clearText);
    // @node-rs/argon2 emits PHC-string with comma-separated params per RFC 9106
    expect(stored.startsWith("$argon2id$v=19$m=65536,t=3,p=1$")).toBe(true);
  });

  it("verifyKey() returns true for the matching pair", async () => {
    const { clearText } = generatePak();
    const stored = await hashKey(clearText);
    expect(await verifyKey(clearText, stored)).toBe(true);
  });

  it("verifyKey() returns false for a non-matching clearText", async () => {
    const a = generatePak();
    const b = generatePak();
    const stored = await hashKey(a.clearText);
    expect(await verifyKey(b.clearText, stored)).toBe(false);
  });

  it("Pitfall #5 — 100 concurrent verify calls complete in <10s on NAPI threadpool", async () => {
    const { clearText } = generatePak();
    const stored = await hashKey(clearText);
    const t0 = Date.now();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => verifyKey(clearText, stored)),
    );
    const elapsed = Date.now() - t0;
    expect(results.every((r) => r === true)).toBe(true);
    // Generous ceiling — the assertion is "does NOT serialize through
    // a single thread"; on a typical CI box 100 concurrent verifies
    // complete in well under 10s on the tokio threadpool.
    expect(elapsed).toBeLessThan(10_000);
  }, 30_000);
});

describe("argon2-keys — parsePakPrefix()", () => {
  it("returns the first 12 chars verbatim", () => {
    expect(parsePakPrefix("pak_abcdef1234567890")).toBe("pak_abcdef12");
  });

  it("agrees with generatePak() prefix output for round-trip clearText", () => {
    const { clearText, prefix } = generatePak();
    expect(parsePakPrefix(clearText)).toBe(prefix);
  });
});
