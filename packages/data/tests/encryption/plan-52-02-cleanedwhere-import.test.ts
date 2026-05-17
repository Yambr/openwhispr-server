// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 52 / Plan 52-02 — pin the lens.ts CleanedWhere import path.
// Pre-fix: `import type { CleanedWhere, DBAdapter, Where } from
// "better-auth"`. better-auth@1.6.9 dropped the `CleanedWhere`
// re-export (it now lives in `@better-auth/core/db/adapter`), so the
// existing import surfaced TS2305 at typecheck and blocked the
// packages/data stage of `make verify`.
//
// Post-fix: split the import so DBAdapter+Where come from `better-auth`
// and CleanedWhere comes from `@better-auth/core/db/adapter`. Source-
// pattern test (Phase 51 precedent) — assert the canonical shape.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const LENS = resolve(__dirname, "../../src/encryption/lens.ts");
const PKG = resolve(__dirname, "../../package.json");

describe("Plan 52-02 — lens.ts CleanedWhere import drift", () => {
  it("imports DBAdapter + Where from `better-auth` (no CleanedWhere there)", () => {
    const src = readFileSync(LENS, "utf8");
    expect(src).toMatch(/import\s+type\s*\{\s*DBAdapter\s*,\s*Where\s*\}\s+from\s+"better-auth"/);
    // The pre-fix bundled import (which included CleanedWhere) must not
    // return; better-auth@1.6.9 doesn't export the symbol anymore.
    expect(src).not.toMatch(/import\s+type\s*\{[^}]*CleanedWhere[^}]*\}\s+from\s+"better-auth"/);
  });

  it("imports CleanedWhere from `@better-auth/core/db/adapter`", () => {
    const src = readFileSync(LENS, "utf8");
    expect(src).toMatch(
      /import\s+type\s*\{\s*CleanedWhere\s*\}\s+from\s+"@better-auth\/core\/db\/adapter"/,
    );
  });

  it("packages/data lists @better-auth/core as a direct dependency", () => {
    const pkg = JSON.parse(readFileSync(PKG, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["@better-auth/core"]).toBe("1.6.9");
  });

  it("dead `cleanedToWhere()` helper is removed (LOCKER-04 dead-code)", () => {
    const src = readFileSync(LENS, "utf8");
    expect(src).not.toMatch(/function\s+cleanedToWhere/);
  });
});
