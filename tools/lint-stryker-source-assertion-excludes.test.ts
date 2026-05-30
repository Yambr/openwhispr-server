// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-stryker-source-assertion-excludes.test.ts — guards the Stryker
 * source-assertion ignore list (stryker.config.json → ignorePatterns).
 *
 * Some tests `readFileSync` a MUTATED `src/**` file and assert on its text.
 * Stryker instruments those files in its sandbox (rewriting e.g.
 * `through.on("close", …)` → `through.on(stryMutAct_…("168") ? "" : …)`), so
 * the literal tokens the tests grep for vanish, the tests fail in Stryker's
 * initial DRY RUN, and Stryker aborts before testing a single mutant. These are
 * source-structure (lint-class) assertions, NOT behavior tests, so they are
 * removed from the Stryker sandbox via `ignorePatterns`. They still run (and
 * gate) under `pnpm test` / `pnpm test:all`.
 *
 * This guard keeps the ignore list honest:
 *   1. The config points at the base vitest config (no stray override).
 *   2. `.claude` is ignored (local agent worktrees pollute the sandbox).
 *   3. Every ignored TEST FILE exists and is genuinely a source-assertion test
 *      (so the list can't quietly accumulate exclusions that shrink coverage).
 *
 * fix 260530-rqk; Nick decision 2026-05-30 ("Stryker-config excludes them").
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const cfg = JSON.parse(readFileSync(join(REPO_ROOT, "stryker.config.json"), "utf8")) as {
  vitest?: { configFile?: string };
  ignorePatterns?: string[];
};

const ignored = cfg.ignorePatterns ?? [];
// The test-file entries (exclude the `.claude` worktree-noise pattern).
const ignoredTests = ignored.filter((p) => p.endsWith(".test.ts"));

describe("Stryker source-assertion ignore list", () => {
  it("uses the base vitest config (no stray Stryker-only config)", () => {
    expect(cfg.vitest?.configFile).toBe("vitest.config.ts");
  });

  it("ignores the local agent-worktree dir that pollutes the sandbox", () => {
    expect(ignored).toContain(".claude");
  });

  it("lists at least one source-assertion test and they are unique", () => {
    expect(ignoredTests.length).toBeGreaterThan(0);
    expect(new Set(ignoredTests).size).toBe(ignoredTests.length);
  });

  it("every ignored test file exists", () => {
    const missing = ignoredTests.filter((rel) => !existsSync(join(REPO_ROOT, rel)));
    expect(missing).toEqual([]);
  });

  it("every ignored test reads source AND asserts on its text (truly source-assertion)", () => {
    const notSourceAssertion: string[] = [];
    for (const rel of ignoredTests) {
      const body = readFileSync(join(REPO_ROOT, rel), "utf8");
      const readsSource = /readFileSync/.test(body);
      const assertsText =
        /toMatch|toContain|\.test\(\s*(src|source|body|raw|content|fileContent)/.test(body);
      if (!readsSource || !assertsText) notSourceAssertion.push(rel);
    }
    expect(notSourceAssertion).toEqual([]);
  });
});
