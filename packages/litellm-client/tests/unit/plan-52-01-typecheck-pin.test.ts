// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 52 / Plan 52-01 — pin the fixes for the 6 typecheck errors that
// blocked `make verify` Stage 3 on `main` pre-Phase-52. The fixes are
// type-system-only; no runtime behaviour change. Source-pattern tests
// (Phase 51 precedent 51-13c, 51-11d/e) — assert the canonical
// post-fix shapes are present so a future refactor that drops one
// reintroduces the typecheck failure here first.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../src");

describe("Plan 52-01 — litellm-client typecheck regressions", () => {
  it("errors.ts uses `declare` on bodyText (Object.defineProperty pattern)", () => {
    const src = readFileSync(resolve(SRC, "errors.ts"), "utf8");
    expect(src).toMatch(/private\s+declare\s+readonly\s+bodyText:\s*string/);
    expect(src).not.toMatch(/^\s*private\s+readonly\s+bodyText:\s*string;/m);
  });

  it("index.ts pins ResponseData<unknown> on the 4 method signatures", () => {
    const src = readFileSync(resolve(SRC, "index.ts"), "utf8");
    // The 4 method signatures + ensureOk helper now carry the explicit
    // generic. Count occurrences as a lower bound (≥5 = 4 methods +
    // ensureOk param OR return = at least 5 hits).
    const hits = src.match(/Dispatcher\.ResponseData<unknown>/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(5);
    // The bare form must not reappear anywhere.
    expect(src).not.toMatch(/Promise<Dispatcher\.ResponseData>/);
    expect(src).not.toMatch(/:\s*Dispatcher\.ResponseData\s*[,)]/);
  });

  it("index.ts uses single `as` cast for Dispatcher symbol-indexer narrowing", () => {
    const src = readFileSync(resolve(SRC, "index.ts"), "utf8");
    expect(src).toMatch(
      /const\s+dispatcher\s*=\s*getGlobalDispatcher\(\)\s+as\s+Dispatcher\s*&\s*\{\s*\[k:\s*symbol\]:\s*unknown\s*\}/,
    );
    // Pre-fix direct annotation form must not return.
    expect(src).not.toMatch(
      /const\s+dispatcher:\s*Dispatcher\s*&\s*\{\s*\[k:\s*symbol\]:\s*unknown\s*\}\s*=\s*getGlobalDispatcher/,
    );
  });
});
