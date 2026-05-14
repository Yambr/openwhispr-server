// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 02.12 — D-04 TDD RED: assert sessions schema exposes a plain `token`
// (text) column matching Better Auth v1.6.9's drizzle-adapter expectation.
//
// Source-of-record commit: <Phase 02.12 atomic fix commit, populated post-commit>
//
// Reverts:
//   - Reverting `packages/data/migrations/0005_session_token_plain.sql` (deletion)
//     OR reverting `packages/data/src/schema/sessions.ts` to the bytea
//     `tokenHash` / `previousTokenHash` shape: this test goes RED because:
//       * `sessions.token` is undefined (BA's drizzle-adapter throws
//         "BetterAuthError: The field 'token' does not exist in the schema
//         for the model 'session'") — the symptom Phase 02.12 closes.
//       * `sessions.tokenHash` returning to the schema would re-fail the
//         negative assertion (`tokenHash` must NOT exist in current shape).
//
// Why this test exists: Phase 02 Plan 01 designed `sessions.tokenHash bytea`
// (AUTH-04 hash-only storage); Better Auth v1.6.9 has no native hashed-token
// support and demands the canonical `session.token` text column. Adopting
// BA-native plain-text storage closes the cascade tail #11 signin failure.
// The AUTH-04 5-minute overlap CONTRACT (behavior, not storage shape)
// survives via the plain-text `previousToken` column.
import { describe, expect, it } from "vitest";

describe("Phase 02.12 — sessions schema exposes plain `token` text (BA-native)", () => {
  it("sessions table has a `token` column wired into the drizzle schema", async () => {
    const { sessions } = await import("@openwhispr/data/schema");
    // Drizzle column proxy: `.token` must exist and be a `text` column.
    // The columnType / dataType internals are exposed via the column's
    // `.columnType` and `.dataType` properties on drizzle-orm 0.45.
    const tokenCol = (sessions as Record<string, unknown>).token as
      | { columnType?: string; dataType?: string }
      | undefined;
    expect(tokenCol).toBeDefined();
    // Drizzle's PgText.columnType === 'PgText'; dataType === 'string'.
    expect(tokenCol?.dataType).toBe("string");
  });

  it("sessions table has a `previousToken` text column (AUTH-04 overlap, plain)", async () => {
    const { sessions } = await import("@openwhispr/data/schema");
    const prev = (sessions as Record<string, unknown>).previousToken as
      | { dataType?: string }
      | undefined;
    expect(prev).toBeDefined();
    expect(prev?.dataType).toBe("string");
  });

  it("sessions table NO LONGER exposes the bytea `tokenHash` column", async () => {
    const { sessions } = await import("@openwhispr/data/schema");
    expect((sessions as Record<string, unknown>).tokenHash).toBeUndefined();
  });

  it("sessions table NO LONGER exposes the bytea `previousTokenHash` column", async () => {
    const { sessions } = await import("@openwhispr/data/schema");
    expect((sessions as Record<string, unknown>).previousTokenHash).toBeUndefined();
  });
});
