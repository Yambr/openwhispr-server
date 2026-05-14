// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 05 / Task 1 — PKCE pure-function tests.
//
// generatePkceVerifier() emits a 43-char URL-safe-base64 string from
// 32 random bytes (crypto-grade). pkceChallengeS256(v) is the SHA-256
// digest of the verifier in URL-safe-base64-no-padding form (RFC 7636).
//
// We pin minimum-spec verifier length (43) for the smallest wire footprint
// without losing security; longer is allowed but pointless.
import { describe, expect, it } from "vitest";
import { generatePkceVerifier, pkceChallengeS256 } from "../../../src/lib/pkce.js";

describe("PKCE helpers (RFC 7636)", () => {
  it("generatePkceVerifier returns a 43-char URL-safe string", () => {
    const verifier = generatePkceVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("generatePkceVerifier returns a fresh string per call", () => {
    const samples = new Set<string>();
    for (let i = 0; i < 50; i++) samples.add(generatePkceVerifier());
    expect(samples.size).toBe(50);
  });

  it("pkceChallengeS256 is deterministic for the same verifier", () => {
    const verifier = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF-";
    const c1 = pkceChallengeS256(verifier);
    const c2 = pkceChallengeS256(verifier);
    expect(c1).toBe(c2);
  });

  it("pkceChallengeS256 returns URL-safe-base64 (no padding) of length 43", () => {
    const challenge = pkceChallengeS256("test-verifier-please-ignore-1234567890ABCDEF");
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toContain("=");
  });

  it("pkceChallengeS256(verifier) !== verifier", () => {
    const verifier = generatePkceVerifier();
    expect(pkceChallengeS256(verifier)).not.toBe(verifier);
  });

  it("matches the RFC 7636 § Appendix B test vector", () => {
    // From RFC 7636 § Appendix B: verifier
    // "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    // produces challenge
    // "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(pkceChallengeS256(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
