// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * stryker-source-assertion-excludes.ts — single source of truth for the
 * Stryker `ignorePatterns` test exclusions.
 *
 * Tests that read a MUTATED `src/**` file as TEXT and assert on its structure
 * break under Stryker: instrumentation rewrites the very tokens they grep for,
 * so they fail in Stryker's initial dry run and abort the whole run before any
 * mutant is tested. They are source-structure (lint-class) assertions, not
 * behavior tests, so they must be removed from the Stryker sandbox (they still
 * run + gate under `pnpm test`).
 *
 * A hand-maintained list silently drifts (a new such test → mutation-quick goes
 * red with a one-at-a-time whack-a-mole). So this module DETECTS them: it scans
 * the test trees of the mutated packages and flags any file that both reads a
 * source file from its package's `src/` AND asserts on that text. The list is
 * written into `stryker.config.json` `ignorePatterns` by
 * `pnpm stryker:sync-excludes`; the companion test fails if the JSON drifts
 * from the detector. fix 260530-rqk.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Packages Stryker mutates (must mirror stryker.config.json `mutate`). */
export const MUTATED_PACKAGES = [
  "apps/api",
  "packages/auth",
  "packages/data",
  "packages/litellm-client",
] as const;

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(full, out);
    } else if (name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
}

/**
 * Heuristic but deliberately INCLUSIVE: a test is a source-assertion test when
 * it (a) reads a file via readFileSync, and (b) the read path mentions the
 * package source tree (`src`), and (c) it asserts on the read text. Over-
 * inclusion is harmless (the test still runs under `pnpm test`); UNDER-
 * inclusion is what breaks Stryker, so the predicate errs toward inclusion.
 */
export function isSourceAssertionTest(body: string): boolean {
  const reads = /readFileSync\s*\(/.test(body);
  if (!reads) return false;
  // Reads a source path: a readFileSync/join/resolve referencing `src` and a
  // `.ts`/`.js`/`.cjs` source extension, OR a `src/index`-style literal.
  const readsSource =
    /readFileSync\([^)]*src[^)]*\)/.test(body) ||
    /(?:join|resolve)\([^;]*["']src["'][^;]*\)/.test(body) ||
    /["'][^"']*\/src\/[^"']*\.(?:ts|js|cjs)["']/.test(body) ||
    /\bsrc\b[^;\n]*\.(?:ts|js|cjs)["'`]/.test(body);
  if (!readsSource) return false;
  // Asserts on the text it read.
  const assertsText =
    /toMatch|toContain|\.indexOf\(|RegExp|toBeGreaterThan|toBeLessThan|\.test\(\s*(?:src|source|body|raw|content|fileContent|text)/.test(
      body,
    );
  return assertsText;
}

/** Detect all source-assertion test files (repo-relative, POSIX, sorted). */
export function detectSourceAssertionTests(repoRoot: string): string[] {
  const found: string[] = [];
  for (const pkg of MUTATED_PACKAGES) {
    const testsRoot = join(repoRoot, pkg, "tests");
    const files: string[] = [];
    walk(testsRoot, files);
    for (const f of files) {
      if (isSourceAssertionTest(readFileSync(f, "utf8"))) {
        found.push(relative(repoRoot, f).split("\\").join("/"));
      }
    }
  }
  return found.sort();
}

/** The non-test ignore patterns that must always be present (worktree noise). */
export const ALWAYS_IGNORE = [".claude"] as const;
