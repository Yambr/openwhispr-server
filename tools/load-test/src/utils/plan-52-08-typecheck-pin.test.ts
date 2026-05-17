// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 52 / Plan 52-08 — pin tools/load-test typecheck fixes.
//
//   {baseline,main,smoke}.ts http.file(bytes, ...) (TS2345 × 3) — k6's
//   `http.file()` signature wants `string | ArrayBuffer` but we pass
//   `Uint8Array`. `bytes.buffer as ArrayBuffer` cast hands the
//   underlying ArrayBuffer view directly (no copy).
//
//   http-client.test.ts:66-74 (TS18048 × 5) — `spy.mock.calls[0]` is
//   `unknown[] | undefined` under strictNullChecks; `call[N]` indexing
//   needs a non-null guard.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");

describe("Plan 52-08 — load-test typecheck pins", () => {
  const httpFileFiles = ["src/baseline.ts", "src/main.ts", "src/smoke.ts"];

  it.each(httpFileFiles)("%s passes bytes.buffer as ArrayBuffer to k6 http.file()", (rel) => {
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    expect(src).toMatch(/http\.file\(bytes\.buffer\s+as\s+ArrayBuffer\s*,/);
    // Pre-fix direct Uint8Array form must not return.
    expect(src).not.toMatch(/http\.file\(bytes\s*,\s*filename/);
  });

  it("http-client.test.ts guards spy.mock.calls[0] non-null before indexing", () => {
    const src = readFileSync(resolve(ROOT, "src/utils/http-client.test.ts"), "utf8");
    expect(src).toMatch(/if\s*\(!call\)\s+throw\s+new\s+Error\(["']expected spy call["']\)/);
  });
});
