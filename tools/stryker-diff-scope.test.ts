// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Tests for stryker-diff-scope.ts — the diff-scoped mutate computation that
 * makes mutation-quick actually quick (root-cause fix for the 68-minute full
 * Stryker run). 260530-rqk follow-up.
 */
import { describe, expect, it } from "vitest";
import {
  isExcluded,
  parseGitDiffNames,
  parseMutateConfig,
  scopeChangedFiles,
  sourceRootsFromIncludes,
} from "./stryker-diff-scope.ts";

// The real config's mutate array, mirrored as a fixture so the test fails
// loudly if the shape ever changes in a way the parser can't handle.
const REAL_MUTATE = [
  "apps/api/src/**/*.ts",
  "packages/auth/src/**/*.ts",
  "packages/data/src/**/*.ts",
  "packages/litellm-client/src/**/*.ts",
  "!**/*.test.ts",
  "!**/*.spec.ts",
  "!**/*.gen.ts",
] as const;

describe("parseMutateConfig", () => {
  it("splits positive globs from negation globs and strips the leading !", () => {
    const cfg = parseMutateConfig(REAL_MUTATE);
    expect(cfg.includeGlobs).toEqual([
      "apps/api/src/**/*.ts",
      "packages/auth/src/**/*.ts",
      "packages/data/src/**/*.ts",
      "packages/litellm-client/src/**/*.ts",
    ]);
    expect(cfg.excludeGlobs).toEqual(["**/*.test.ts", "**/*.spec.ts", "**/*.gen.ts"]);
  });

  it("ignores empty / non-string entries", () => {
    const cfg = parseMutateConfig(["apps/api/src/**/*.ts", "", "!**/*.test.ts"]);
    expect(cfg.includeGlobs).toEqual(["apps/api/src/**/*.ts"]);
    expect(cfg.excludeGlobs).toEqual(["**/*.test.ts"]);
  });
});

describe("sourceRootsFromIncludes", () => {
  it("derives directory prefixes (cut at first glob metachar, back to last /)", () => {
    const roots = sourceRootsFromIncludes(["apps/api/src/**/*.ts", "packages/auth/src/**/*.ts"]);
    expect(roots).toEqual(["apps/api/src/", "packages/auth/src/"]);
  });

  it("de-duplicates identical roots", () => {
    const roots = sourceRootsFromIncludes(["apps/api/src/**/*.ts", "apps/api/src/**/*.spec.ts"]);
    expect(roots).toEqual(["apps/api/src/"]);
  });

  it("keeps a nested prefix distinct (harmless — startsWith still matches files under it)", () => {
    const roots = sourceRootsFromIncludes(["apps/api/src/**/*.ts", "apps/api/src/routes/**/*.ts"]);
    expect(roots).toEqual(["apps/api/src/", "apps/api/src/routes/"]);
  });
});

describe("isExcluded", () => {
  const ex = ["**/*.test.ts", "**/*.spec.ts", "**/*.gen.ts"];
  it("matches negation suffixes", () => {
    expect(isExcluded("apps/api/src/foo.test.ts", ex)).toBe(true);
    expect(isExcluded("apps/api/src/foo.spec.ts", ex)).toBe(true);
    expect(isExcluded("packages/data/src/schema.gen.ts", ex)).toBe(true);
  });
  it("does not match plain source files", () => {
    expect(isExcluded("apps/api/src/foo.ts", ex)).toBe(false);
  });
});

describe("scopeChangedFiles", () => {
  const config = parseMutateConfig(REAL_MUTATE);

  it("keeps only mutate-eligible source files from the diff", () => {
    const changed = [
      "apps/api/src/routes/health.ts", // keep
      "packages/data/src/schema/users.ts", // keep
      "apps/api/src/routes/health.test.ts", // drop: negation
      "packages/data/src/schema/users.gen.ts", // drop: negation
      "apps/web/src/app/page.tsx", // drop: not a mutate root + .tsx
      "docs/security.md", // drop: not source
      ".github/workflows/ci.yml", // drop: not source
      "tools/stryker-diff-scope.ts", // drop: not a mutate root
    ];
    expect(scopeChangedFiles(changed, config)).toEqual([
      "apps/api/src/routes/health.ts",
      "packages/data/src/schema/users.ts",
    ]);
  });

  it("returns an empty list for a docs/CI-only PR (the 68-min-bug case)", () => {
    const changed = [".github/workflows/ci.yml", "docs/security.md", "README.md"];
    expect(scopeChangedFiles(changed, config)).toEqual([]);
  });

  it("de-duplicates and sorts", () => {
    const changed = ["packages/auth/src/b.ts", "apps/api/src/a.ts", "apps/api/src/a.ts"];
    expect(scopeChangedFiles(changed, config)).toEqual([
      "apps/api/src/a.ts",
      "packages/auth/src/b.ts",
    ]);
  });

  it("ignores blank lines and whitespace from raw git output", () => {
    const changed = ["", "  ", " apps/api/src/a.ts ", "\tpackages/data/src/c.ts"];
    expect(scopeChangedFiles(changed, config)).toEqual([
      "apps/api/src/a.ts",
      "packages/data/src/c.ts",
    ]);
  });
});

describe("parseGitDiffNames", () => {
  it("splits newline output and trims blanks", () => {
    expect(parseGitDiffNames("a.ts\nb.ts\n\n  c.ts  \n")).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
  it("handles empty output", () => {
    expect(parseGitDiffNames("")).toEqual([]);
    expect(parseGitDiffNames("\n\n")).toEqual([]);
  });
});
