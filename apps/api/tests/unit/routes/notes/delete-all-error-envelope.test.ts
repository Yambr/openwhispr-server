// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 64 / Plan 01 / Task 5 — H-4 (non-canonical 400 emission).
//
// Finding: notes/delete-all.ts over-limit failure used an inline
// `reply.code(400).send({ error: <string> })`. Every sibling 4xx in
// scope instead throws `new ValidationError(CODE, msg)` so the
// centralized `setErrorHandler` is the SINGLE emission point — the
// inline emission bypasses i18n localization and the uniform
// error-logging the centralized handler applies (error-handler.ts:4-8:
// "All HTTP error responses MUST flow through this handler ... rather
// than calling reply.status(...).send(...) inline").
//
// NOTE on the envelope shape: this repo's canonical error envelope is
// `{ error: <string> }` (error-handler.ts:4), NOT a `{code,message}`
// object — see the verify-first.log H-4 divergence note. The H-4 fix is
// therefore about ROUTING the 400 through the centralized handler, not
// about changing the envelope's string→object shape.
//
// RED (pre-fix): delete-all.ts emits its 400 inline via
// `reply.code(400).send(...)` and never imports/throws ValidationError.
// GREEN: it throws `ValidationError` and the inline emission is gone.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const DELETE_ALL_SRC = resolve(TEST_DIR, "../../../../src/routes/notes/delete-all.ts");

describe("H-4 — notes/delete-all over-limit 400 routes through ValidationError", () => {
  it("H-4 — delete-all.ts throws ValidationError for the over-limit 400", () => {
    const src = readFileSync(DELETE_ALL_SRC, "utf8");
    // Imports ValidationError from the errors module.
    expect(src).toMatch(
      /import\s*\{[^}]*\bValidationError\b[^}]*\}\s*from\s*["']\.\.\/\.\.\/errors\.js["']/,
    );
    // Throws it for the over-limit branch.
    expect(src).toMatch(/throw new ValidationError\(/);
  });

  it("H-4 — delete-all.ts no longer emits the 400 inline via reply.code(400).send", () => {
    const src = readFileSync(DELETE_ALL_SRC, "utf8");
    expect(src).not.toMatch(/reply\.code\(400\)\.send/);
  });
});
