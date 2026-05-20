// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 68 / Plan 68-01 — REVIEW web HIGH HI-02.
//
// `SessionsTable` holds a Better Auth bearer (`SessionRow.token`) in the
// JS heap because `authClient.listSessions()` returns it and
// `authClient.revokeSession({ token })` requires it — Better Auth 1.6.9
// exposes NO id-based `revokeSession` overload (confirmed against
// `better-auth/dist/api/routes/session.d.mts` — body is `{ token }` only).
//
// HI-02 resolution is the documentation route: the bearer is unavoidable
// in heap, but it MUST NOT reach any rendered DOM surface. This test pins:
//   * `row.token` is referenced ONLY inside the revoke mutation closure
//     (`revokeOne.mutate(row.token)`) — never as a DOM attribute, a
//     `data-*` attribute, or a React `key`.
//   * the file header documents the unavoidable bearer exposure + the
//     CSP `connect-src` containment posture + the durable v2 fix.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const TABLE_SRC = resolve(
  TEST_DIR,
  "../../../../../src/components/screens/account/SessionsTable.tsx",
);

const src = readFileSync(TABLE_SRC, "utf8");
// Strip line + block comments so narrative references to the anti-pattern
// (citing the fix rationale) don't false-positive.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("HI-02 — SessionsTable session bearer must not reach the DOM", () => {
  it("HI-02: `token` never appears inside a React key prop", () => {
    expect(/key=\{[^}]*\.token[^}]*\}/.test(code)).toBe(false);
  });

  it("HI-02: `token` never appears inside a data-* attribute", () => {
    expect(/data-[\w-]+=\{[^}]*\.token[^}]*\}/.test(code)).toBe(false);
  });

  it("HI-02: `.token` is only ever passed to the revoke mutation closure", () => {
    // Every `.token` reference in code (not comments) must be the
    // `revokeOne.mutate(row.token)` call site — no other use.
    const tokenRefs = code.match(/\.token\b/g) ?? [];
    expect(tokenRefs.length).toBeGreaterThan(0);
    const mutateRefs = code.match(/revokeOne\.mutate\(row\.token\)/g) ?? [];
    // `mutationFn: async (token: string)` references the param, not `.token`;
    // the only `.token` member access is the mutate call.
    expect(tokenRefs.length).toBe(mutateRefs.length);
  });

  it("HI-02: file header documents the unavoidable bearer heap exposure", () => {
    expect(src).toMatch(/HI-02/);
    expect(src).toMatch(/connect-src/);
    // header notes Better Auth 1.6.9 is token-only (no id-based revoke).
    const headerText = src.toLowerCase().replace(/\/\//g, " ").replace(/\s+/g, " ");
    expect(headerText).toMatch(/no\s+id-based revocation|token-only/);
  });
});
