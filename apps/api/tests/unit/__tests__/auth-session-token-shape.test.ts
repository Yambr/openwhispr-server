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
//
// This test exists as a regression sentinel for Phase 33's shape: a
// future refactor that re-introduces a plaintext `token` text column
// (intentionally or accidentally) will be caught here AND by the
// `tools/lint-no-plaintext-secret-columns.ts` locker. The lint is the
// authoritative constraint; this test is defence-in-depth at the
// drizzle column-proxy level.
import { describe, expect, it } from "vitest";

describe("Phase 33 — sessions schema exposes envelope-encrypted token (LOCKER-08)", () => {
  it("sessions table has a NOT-NULL bytea `tokenFp` fingerprint column", async () => {
    const { sessions } = await import("@openwhispr/data/schema");
    const fp = (sessions as Record<string, unknown>).tokenFp as
      | { columnType?: string; dataType?: string; notNull?: boolean }
      | undefined;
    expect(fp).toBeDefined();
    // Drizzle bytea columns surface as columnType 'PgCustomColumn' /
    // dataType 'buffer'. The exact internals depend on drizzle-orm
    // minor; assert the broad shape (defined + non-null).
    expect(fp?.notNull).toBe(true);
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

  it("sessions table NO LONGER exposes the legacy plain `token` text column (LOCKER-08)", async () => {
    const { sessions } = await import("@openwhispr/data/schema");
    expect((sessions as Record<string, unknown>).token).toBeUndefined();
    expect((sessions as Record<string, unknown>).previousToken).toBeUndefined();
  });

  it("sessions table NO LONGER exposes the historical Phase 02.01 bytea `tokenHash` shape", async () => {
    const { sessions } = await import("@openwhispr/data/schema");
    expect((sessions as Record<string, unknown>).tokenHash).toBeUndefined();
    expect((sessions as Record<string, unknown>).previousTokenHash).toBeUndefined();
  });
});
