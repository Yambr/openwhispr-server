// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-13 — RED→GREEN regression for REVIEW-INDEX.md
// api-core HIGH HI-01: the file header on token-rotation.ts (and the
// adjacent narrative comment in apps/api/src/index.ts ~L469) used to
// advertise "plaintext bearer storage" — that is the storage shape
// the codebase left behind in Phase 33 / Plan 33-05 (migration 0020
// dropped the plaintext column). Both narratives now reflect the
// fingerprint-only reality.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROT_SRC = resolve(TEST_DIR, "../../../src/lib/token-rotation.ts");
const INDEX_SRC = resolve(TEST_DIR, "../../../src/index.ts");

describe("Plan 51-13 — token-rotation narrative truth", () => {
  it("token-rotation.ts header acknowledges Phase 33 fingerprint-only storage", () => {
    const src = readFileSync(ROT_SRC, "utf8");
    // The honest narrative must mention BOTH the Phase 33 fingerprint
    // shape AND the dropped plaintext column.
    expect(/Phase 33/.test(src)).toBe(true);
    expect(/fingerprint/i.test(src)).toBe(true);
    expect(/migration 0020/.test(src)).toBe(true);
  });

  it("apps/api/src/index.ts onSend hook comment no longer claims plain-text storage", () => {
    const src = readFileSync(INDEX_SRC, "utf8");
    // The recPrev call site must no longer carry the stale
    // "store the old bearer plain-text" comment; it should reference
    // the fingerprint-only reality.
    // Phase 52 / Plan 52-09 — replaced `opts.db!` non-null assertion
    // with explicit `opts.db &&` guard; call site now reads
    // `await recPrev(opts.db, …)` without the `!` operator.
    const m = src.match(/await recPrev\(opts\.db,/);
    expect(m, "recPrev call site not found").toBeTruthy();
    // Grab a 700-char window around the call to inspect comments.
    const idx = src.indexOf("await recPrev(opts.db,");
    const window = src.slice(Math.max(0, idx - 700), idx);
    expect(/store the old bearer plain-text/i.test(window)).toBe(false);
    expect(/fingerprint/i.test(window)).toBe(true);
  });
});
