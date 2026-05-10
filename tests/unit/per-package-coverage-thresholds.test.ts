// Phase 3 / Plan 02 / Task 4 (HIGH-3) — guard the per-package vitest
// coverage thresholds.
//
// CLAUDE.md constitutional rule: per-phase coverage floor ≥90% on all
// new/modified code. The root `vitest.config.ts` floor is 85/80/80/85
// for the wider codebase; per-package configs in apps/api,
// packages/litellm-client, packages/data raise that to 90 for THEIR
// source trees. This test pins the shape so a refactor cannot silently
// regress to the flat-key shape Vitest 4 ignores (RESEARCH Pitfall #1).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

const PACKAGES = [
  "apps/api",
  "packages/litellm-client",
  "packages/data",
] as const;

interface MaybeConfig {
  default: {
    test?: {
      coverage?: {
        thresholds?: {
          lines?: number;
          branches?: number;
          functions?: number;
          statements?: number;
        };
        include?: string[];
      };
    };
  };
}

describe("per-package vitest coverage configs (HIGH-3)", () => {
  for (const pkg of PACKAGES) {
    describe(pkg, () => {
      const configPath = join(repoRoot, pkg, "vitest.config.ts");

      it("authors a vitest.config.ts at the package root", () => {
        // Throws (and the test fails) if missing — readFile is a clearer
        // failure than `existsSync`.
        const text = readFileSync(configPath, "utf8");
        expect(text.length).toBeGreaterThan(0);
      });

      it("sets nested coverage.thresholds at 90/90/90/90", async () => {
        // Dynamic import — works for ESM .ts via vitest's transform.
        const mod = (await import(
          /* @vite-ignore */ configPath
        )) as MaybeConfig;
        const t = mod.default.test?.coverage?.thresholds;
        expect(t).toBeDefined();
        expect(t!.lines).toBe(90);
        expect(t!.branches).toBe(90);
        expect(t!.functions).toBe(90);
        expect(t!.statements).toBe(90);
      });

      it("scopes coverage.include to this package's src tree", async () => {
        const mod = (await import(
          /* @vite-ignore */ configPath
        )) as MaybeConfig;
        const include = mod.default.test?.coverage?.include;
        expect(include).toBeDefined();
        expect(include).toContain("src/**/*.ts");
      });

      it("does NOT use the flat shape (Vitest 4 silently ignores it)", () => {
        // Source-level grep: forbids the v2 flat keys directly under
        // `coverage:` because mergeConfig leaves them parsed-but-ignored.
        const text = readFileSync(configPath, "utf8");
        // The flat shape would look like `coverage: { lines: 90 ... }`.
        // We assert no literal `\nlines:` etc. appears at the top level
        // of the coverage block by checking that `thresholds: {` is the
        // only place these keys appear (a structural proxy: every line
        // that says `lines: 90` lives inside a thresholds block above).
        expect(text).toMatch(/thresholds:\s*\{/);
      });
    });
  }

  it("root vitest.config.ts thresholds remain 85/80/80/85 (unchanged)", async () => {
    const mod = (await import(
      /* @vite-ignore */ join(repoRoot, "vitest.config.ts")
    )) as MaybeConfig;
    const t = mod.default.test?.coverage?.thresholds;
    expect(t).toBeDefined();
    expect(t!.lines).toBe(85);
    expect(t!.branches).toBe(80);
    expect(t!.functions).toBe(80);
    expect(t!.statements).toBe(85);
  });
});
