// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 33-05 — sessions schema exposes envelope-encrypted token
// storage (LOCKER-08 / CRIT-FIX-02).
//
// History:
//   Phase 02.01: `sessions.tokenHash bytea` (AUTH-04 hash-only storage).
//   Phase 02.12: replaced with plain `sessions.token` text (BA-native;
//                drizzle-adapter expects this shape).
//   Phase 33 / Plan 33-05 / LOCKER-08: plain-text credential columns
//                are CONSTITUTIONALLY BANNED; `token` + `previous_token`
//                are envelope-encrypted into 6 nullable bytea sidecars
//                per column plus a SHA-256 fingerprint (`token_fp`
//                NOT NULL; `previous_token_fp` nullable). The unique
//                contract from Phase 02.12 is preserved on the
//                fingerprint, not the plaintext.
//   Plan 51-23/24 (LOCKER-08 AMENDMENT): the plaintext `token` and
//                `previous_token` columns are RESTORED as nullable,
//                no-DEFAULT Better-Auth-introspection compat sentinels
//                under the inline LENS_INTROSPECTION_COMPAT allowlist
//                in tools/lint-no-plaintext-secret-columns.ts. The 6
//                bytea sidecars per credential continue to exist as
//                defence-in-depth at rest. sessions.token_fp is RELAXED
//                to nullable (Better Auth bypasses the lens; the
//                fingerprint slot is never populated by BA writes).
//                A new partial UNIQUE INDEX
//                `sessions_token_unique_partial` on plaintext `token`
//                preserves the Plan 02.12 uniqueness contract at the
//                BA-write layer.
//
// This test exists as a regression sentinel for the FINAL post-amendment
// shape: a future refactor that drops EITHER the plaintext compat
// columns OR the bytea sidecar set will be caught here AND by the
// `tools/lint-no-plaintext-secret-columns.ts` locker (which enforces
// "no plaintext credential columns EXCEPT exactly the ones in
// LENS_INTROSPECTION_COMPAT"). The lint is the authoritative
// constraint; this test is defence-in-depth at the drizzle
// column-proxy level.
import { describe, expect, it } from "vitest";

describe("Phase 33 + Plan 51-23/24 amendment — sessions schema exposes envelope-encrypted token + compat sentinels (LOCKER-08)", () => {
  it("sessions table has a nullable bytea `tokenFp` fingerprint column (Plan 51-24 relaxed NOT NULL)", async () => {
    const { sessions } = await import("@openwhispr/data/schema");
    const fp = (sessions as Record<string, unknown>).tokenFp as
      | { columnType?: string; dataType?: string; notNull?: boolean }
      | undefined;
    expect(fp).toBeDefined();
    // Plan 51-24 — sessions.token_fp is now NULLABLE at DB layer
    // (migration 0026) because Better Auth bypasses the encryption
    // lens; the fingerprint slot is unpopulated by BA writes. Uniqueness
    // contract moved to the new partial UNIQUE INDEX on plaintext
    // `token`. Drizzle's `notNull` flag mirrors the DB state.
    expect(fp?.notNull).toBe(false);
  });

  it("sessions table has the full envelope-encryption sidecar set for `token`", async () => {
    const { sessions } = await import("@openwhispr/data/schema");
    const cols = sessions as Record<string, unknown>;
    for (const name of [
      "tokenDekWrapped",
      "tokenDekIv",
      "tokenDekAuthTag",
      "tokenValueIv",
      "tokenValueAuthTag",
      "tokenValueCiphertext",
    ]) {
      expect(cols[name]).toBeDefined();
    }
  });

  it("sessions table has the full envelope-encryption sidecar set for `previousToken` (AUTH-04 overlap)", async () => {
    const { sessions } = await import("@openwhispr/data/schema");
    const cols = sessions as Record<string, unknown>;
    for (const name of [
      "previousTokenDekWrapped",
      "previousTokenDekIv",
      "previousTokenDekAuthTag",
      "previousTokenValueIv",
      "previousTokenValueAuthTag",
      "previousTokenValueCiphertext",
      "previousTokenFp",
      "previousTokenExpiresAt",
    ]) {
      expect(cols[name]).toBeDefined();
    }
  });

  it("sessions table HAS the Plan 51-23 compat plain `token` + `previousToken` columns alongside sidecars (LENS_INTROSPECTION_COMPAT allowlist)", async () => {
    const { sessions } = await import("@openwhispr/data/schema");
    const cols = sessions as Record<string, unknown>;
    // Plan 51-23 — the 2 plaintext compat sentinels MUST coexist with
    // their respective 6-bytea sidecar sets. Both are nullable, no-
    // DEFAULT; their existence is authoritatively gated by the
    // LOCKER-08 LENS_INTROSPECTION_COMPAT inline allowlist.
    expect(cols.token).toBeDefined();
    expect(cols.previousToken).toBeDefined();
    const tokenCol = cols.token as { notNull?: boolean; hasDefault?: boolean };
    const prevTokenCol = cols.previousToken as { notNull?: boolean; hasDefault?: boolean };
    expect(tokenCol.notNull).toBe(false);
    expect(prevTokenCol.notNull).toBe(false);
    expect(tokenCol.hasDefault).toBe(false);
    expect(prevTokenCol.hasDefault).toBe(false);
  });

  it("sessions table NO LONGER exposes the historical Phase 02.01 bytea `tokenHash` shape", async () => {
    const { sessions } = await import("@openwhispr/data/schema");
    expect((sessions as Record<string, unknown>).tokenHash).toBeUndefined();
    expect((sessions as Record<string, unknown>).previousTokenHash).toBeUndefined();
  });
});
