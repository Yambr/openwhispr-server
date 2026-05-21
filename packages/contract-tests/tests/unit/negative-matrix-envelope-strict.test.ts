// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 68 / Plan 68-01 — REVIEW byok HIGH HI-04.
//
// The negative matrix previously parsed every error body with a
// permissive `TolerantEnvelope` union that accepted BOTH the default
// `{error: string}` shape AND a structured `{error: {message, code?}}`
// shape. A route accidentally emitting the structured object instead of
// the canonical string would still pass the matrix — the contract was
// weakened. HI-04 tightens it to `DefaultErrorEnvelope` (string form,
// `.strict()`).
//
// This test also confirms the route-inventory drift guard
// (`__tests__/negative-matrix-enumeration.test.ts`) is present so a new
// `/api/*` route cannot silently escape the matrix.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DefaultErrorEnvelope } from "../../src/negative-matrix.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

describe("HI-04 — negative-matrix DefaultErrorEnvelope is strict", () => {
  it("HI-04: accepts the canonical { error: string } envelope", () => {
    expect(() => DefaultErrorEnvelope.parse({ error: "rate limited" })).not.toThrow();
  });

  it("HI-04: REJECTS the structured { error: { message } } envelope", () => {
    expect(() => DefaultErrorEnvelope.parse({ error: { message: "boom" } })).toThrow();
  });

  it("HI-04: REJECTS an empty error string", () => {
    expect(() => DefaultErrorEnvelope.parse({ error: "" })).toThrow();
  });

  it("HI-04: REJECTS extra fields (no stack-frame / internal-state leak surface)", () => {
    expect(() => DefaultErrorEnvelope.parse({ error: "x", stack: "leak" })).toThrow();
  });

  it("HI-04: the route-inventory drift guard (enumeration test) is present", () => {
    const guard = resolve(TEST_DIR, "__tests__/negative-matrix-enumeration.test.ts");
    expect(existsSync(guard)).toBe(true);
  });
});
