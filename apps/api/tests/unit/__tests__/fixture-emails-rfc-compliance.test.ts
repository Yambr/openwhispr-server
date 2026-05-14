// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 02.9 / D-02 — Conformance fixture email addresses must satisfy
 * Better Auth v1.6.9's email validator (Zod v4 `z.email()` from Zod v4.x),
 * which enforces RFC 5321/5322 (require a TLD; reject single-label hosts
 * like `@local`).
 *
 * Source-of-record commit: <filled at commit time>
 *
 * Reverts: this test goes RED if `packages/data/src/seed/conformance.ts:36`
 *   reverts from `rotation-test@example.com` back to `rotation-test@local`.
 *   Specifically the `rotation-test@example.com passes Zod v4 z.email()
 *   validation` case fails with a Zod issue against the single-label TLD.
 *
 * Empirical confirmation against installed `zod@4.4.3`:
 *   - `fixture@conformance.test`     → OK (RFC 2606 reserved TLD, valid)
 *   - `verified@conformance.test`    → OK
 *   - `pending@conformance.test`     → OK
 *   - `poll@conformance.test`        → OK
 *   - `rotation-test@local`          → FAIL (no TLD)
 *   - `rotation-test@example.com`    → OK (replacement)
 *
 * Validates the closed-cascade contract: every fixture address shipped by
 * `CONFORMANCE_FIXTURES` reaches Better Auth's signup pipeline past the
 * email validator (eliminating the Phase 02.8 cascade-tail HTTP 400 on
 * the rotation-test fixture row).
 */

import { CONFORMANCE_FIXTURES } from "@openwhispr/data/seed/conformance";
import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("Phase 02.9 — CONFORMANCE_FIXTURES emails are RFC-compliant per Zod v4 z.email()", () => {
  for (const fixture of CONFORMANCE_FIXTURES) {
    it(`${fixture.email} passes Zod v4 z.email() validation`, () => {
      const result = z.email().safeParse(fixture.email);
      expect(result.success).toBe(true);
    });
  }

  it("CONFORMANCE_FIXTURES is non-empty (guards against accidental fixture removal)", () => {
    expect(CONFORMANCE_FIXTURES.length).toBeGreaterThan(0);
  });
});
