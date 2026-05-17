// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-08 — RED→GREEN regression for REVIEW-INDEX.md CR-2.
//
// The pre-fix route used a bare `(req.body ?? {}) as RequestBody` cast.
// Multi-MB `model` strings and arbitrary extra keys flowed through to
// an outbound POST against the paid OpenAI realtime token endpoint —
// authed-user amplification primitive on a paid-provider hop.
//
// This test asserts the route now carries a strict zod schema by
// reading the source file (the only stable accessor in fastify v5).
// Functional assertions exercising the 400-on-bad-body path live in
// the sister file `openai-realtime.test.ts` and continue to pass.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROUTE_SRC = fileURLToPath(
  new URL("../../../../src/routes/tokens/openai-realtime.ts", import.meta.url),
);

describe("Plan 51-08 — /api/openai-realtime-token validates via zod", () => {
  it("source imports OpenAIRealtimeTokenRequest from @openwhispr/wire-schemas", () => {
    const src = readFileSync(ROUTE_SRC, "utf8");
    expect(
      /import\s*\{[^}]*OpenAIRealtimeTokenRequest[^}]*\}\s*from\s*"@openwhispr\/wire-schemas"/.test(
        src,
      ),
    ).toBe(true);
  });

  it("source calls OpenAIRealtimeTokenRequest.safeParse on the request body", () => {
    const src = readFileSync(ROUTE_SRC, "utf8");
    expect(/OpenAIRealtimeTokenRequest\.safeParse\s*\(\s*req\.body/.test(src)).toBe(true);
  });

  it("source no longer carries the bare `as RequestBody` cast (excludes commentary)", () => {
    const src = readFileSync(ROUTE_SRC, "utf8");
    // Strip line comments before pattern-matching so a JSDoc /
    // narrative reference to the OLD `as RequestBody` cast (which we
    // intentionally cite in the fix-rationale comment) doesn't fail
    // the lint-style assertion.
    const stripped = src.replace(/\/\/[^\n]*/g, "");
    expect(/as\s+RequestBody/.test(stripped)).toBe(false);
  });
});
