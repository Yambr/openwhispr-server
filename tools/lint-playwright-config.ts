#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-playwright-config.ts — Playwright/vitest anti-flake linter.
 *
 * Phase 21 / Plan 21-02 / SR-21.2.
 *
 * Three invariants:
 *
 *   1. NO `retries: N` where N > 0 in any `playwright.config.ts`. Per D-12
 *      the e2e-cjm harness is a deterministic ships-first gate; retry-on-flake
 *      is BANNED. A flake IS a bug. This also catches dynamic forms like
 *      `retries: process.env.CI ? 2 : 0` because the > 0 path is a violation
 *      regardless of when it fires.
 *
 *   2. `tests/e2e-cjm/playwright.config.ts` MUST declare `workers: 1` (or
 *      omit it — Playwright default is parallel, so omitting is a violation
 *      too, but we leave the explicitness audit to a human; here we only
 *      flag explicit `workers: N > 1`). Per the D-13 isolation invariant
 *      the CJM harness runs scenarios sequentially. Other playwright
 *      configs (apps/web/playwright.config.ts) are free to parallelize.
 *
 *   3. NO `test.skip` / `test.only` / `test.fixme` / `it.skip` /
 *      `describe.only` / etc. outside of `**\/__tests__/**` directories.
 *      Fixtures under `__tests__/` legitimately exercise the directives —
 *      e.g. lint-cjm-doc.test.ts fixtures.
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one offender
 *   2 — internal error
 *
 * Usage:
 *   pnpm tsx tools/lint-playwright-config.ts
 *   pnpm tsx tools/lint-playwright-config.ts --root <dir>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

export interface Offender {
  file: string;
  line: number;
  col: number;
  message: string;
}

// `retries: N` where N is a literal > 0 OR a non-literal expression (the
// latter could be `process.env.CI ? 2 : 0` etc. — flagged conservatively).
const RETRIES_KEY_RE = /retries\s*:\s*([^,\n}]+)/g;
const WORKERS_KEY_RE = /workers\s*:\s*([^,\n}]+)/g;

/**
 * Strip `//` line comments and `/* … *\/` block comments from a config body
 * so the key regex can't match the text inside a developer note.
 */
function stripComments(src: string): string {
  // Remove block comments first (greedy across newlines disabled — non-greedy).
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  // Then line comments. Replace with spaces to preserve byte offsets so the
  // line-number computation in callers stays accurate.
  out = out.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  return out;
}
// test.skip(...) — Playwright has TWO `test.skip` signatures:
//   (1) test.skip("title", body)  — STATIC skip of a whole test (BANNED here)
//   (2) test.skip(condition, reason?) — RUNTIME conditional skip (ALLOWED)
// We flag only (1): a `.skip(` immediately followed by a string literal
// (template literal, single-quote, or double-quote opener).
// Same logic for .only and .fixme. `.step` is unrelated and not matched.
const SKIP_ONLY_FIXME_RE =
  /\b(?:test|it|describe|context|suite)\.(?:skip|only|fixme)\s*\(\s*['"`]/g;
const TESTS_DIR_SEGMENT = "__tests__";

/** Rule 1 — flag retries > 0 in playwright configs. */
export function lintNoRetries(configs: Map<string, string>): Offender[] {
  const offenders: Offender[] = [];
  for (const [file, raw] of configs) {
    const body = stripComments(raw);
    RETRIES_KEY_RE.lastIndex = 0;
    for (const m of body.matchAll(RETRIES_KEY_RE)) {
      /* c8 ignore next — matchAll always sets index; defense-in-depth only */
      if (m.index === undefined) continue;
      const value = m[1].trim();
      const isLiteralZero = /^0$/.test(value);
      if (isLiteralZero) continue;
      const before = body.slice(0, m.index);
      const line = before.split("\n").length;
      offenders.push({
        file,
        line,
        col: 1,
        message: `forbidden \`retries: ${value}\` — D-12: retry-on-flake is BANNED in playwright configs; only \`retries: 0\` is allowed`,
      });
    }
  }
  return offenders;
}

/** Rule 2 — workers MUST be 1 in tests/e2e-cjm/playwright.config.ts. */
export function lintWorkersBound(configs: Map<string, string>): Offender[] {
  const offenders: Offender[] = [];
  for (const [file, raw] of configs) {
    if (!file.includes("tests/e2e-cjm")) continue;
    const body = stripComments(raw);
    WORKERS_KEY_RE.lastIndex = 0;
    for (const m of body.matchAll(WORKERS_KEY_RE)) {
      /* c8 ignore next — matchAll always sets index; defense-in-depth only */
      if (m.index === undefined) continue;
      const value = m[1].trim();
      const isOne = /^1$/.test(value);
      if (isOne) continue;
      const before = body.slice(0, m.index);
      const line = before.split("\n").length;
      offenders.push({
        file,
        line,
        col: 1,
        message: `forbidden \`workers: ${value}\` — D-13: tests/e2e-cjm/playwright.config.ts MUST be sequential (\`workers: 1\`)`,
      });
    }
  }
  return offenders;
}

/** Rule 3 — no test.skip/only/fixme outside __tests__. */
export function lintNoSkipOrOnlyOutsideTests(testFiles: Map<string, string>): Offender[] {
  const offenders: Offender[] = [];
  for (const [file, raw] of testFiles) {
    if (file.split("/").includes(TESTS_DIR_SEGMENT)) continue;
    // The linter's own test fixtures legitimately contain the banned tokens
    // as STRING LITERALS to exercise the rule. Skip linting the linter test.
    if (/tools\/lint-playwright-config\.test\.ts$/.test(file)) continue;
    const body = stripComments(raw);
    SKIP_ONLY_FIXME_RE.lastIndex = 0;
    for (const m of body.matchAll(SKIP_ONLY_FIXME_RE)) {
      /* c8 ignore next — matchAll always sets index; defense-in-depth only */
      if (m.index === undefined) continue;
      const before = body.slice(0, m.index);
      const line = before.split("\n").length;
      offenders.push({
        file,
        line,
        col: 1,
        message: `forbidden ${m[0]} — test.skip/only/fixme is banned outside **/__tests__/**; if you truly need to skip, use @expected-red @after-phase-N`,
      });
    }
  }
  return offenders;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  ".bdd-gen",
  "coverage",
  ".next",
  ".stryker-tmp",
  ".pnpm-store",
  ".claude", // git worktrees + agent-scratch dirs; not part of main tree
  ".git",
]);

function walk(dir: string, predicate: (full: string, name: string) => boolean): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = resolve(dir, entry);
    let st: ReturnType<typeof statSync> | undefined;
    try {
      st = statSync(full);
    } catch {
      /* c8 ignore next — race: file disappears between readdir + stat */
      continue;
    }
    if (st === undefined) continue;
    if (st.isDirectory()) {
      out.push(...walk(full, predicate));
    } else if (predicate(full, entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Recursively collect every `playwright.config.ts` in `root`. */
export function collectPlaywrightConfigs(root: string): string[] {
  return walk(root, (_full, name) => name === "playwright.config.ts");
}

/** Recursively collect every `*.test.ts` and `*.spec.ts` in `root`. */
export function collectTestFiles(root: string): string[] {
  return walk(root, (_full, name) => /\.(test|spec)\.tsx?$/.test(name));
}

export interface RunOptions {
  argv: readonly string[];
  cwd: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function parseArgs(argv: readonly string[]): { root: string } {
  let root = ".";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") {
      root = argv[i + 1] ?? root;
      i += 1;
    }
  }
  return { root };
}

function readMap(files: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of files) {
    try {
      map.set(f, readFileSync(f, "utf8"));
    } catch {
      /* c8 ignore next — unreadable file, skip */
    }
  }
  return map;
}

function reportOffenders(offenders: Offender[], stderr: (s: string) => void): void {
  stderr(`Playwright-config lint violation: ${offenders.length} offender(s).\n`);
  for (const o of offenders) {
    stderr(`  ${o.file}:${o.line}:${o.col}  ${o.message}\n`);
  }
}

export async function run(opts: RunOptions): Promise<number> {
  const { argv, cwd, stdout, stderr } = opts;
  const { root } = parseArgs(argv);
  const rootPath = resolve(cwd, root);

  let configs: Map<string, string>;
  let tests: Map<string, string>;
  try {
    configs = readMap(collectPlaywrightConfigs(rootPath));
    tests = readMap(collectTestFiles(rootPath));
  } catch (err) {
    /* c8 ignore next 2 — readdirSync errors already swallowed by walk(); defense-in-depth */
    stderr(`lint-playwright-config: internal error: ${String(err)}\n`);
    return 2;
  }

  const offenders: Offender[] = [
    ...lintNoRetries(configs),
    ...lintWorkersBound(configs),
    ...lintNoSkipOrOnlyOutsideTests(tests),
  ];

  if (offenders.length > 0) {
    reportOffenders(offenders, stderr);
    return 1;
  }
  stdout(
    `Playwright-config lint passed: ${configs.size} config(s), ${tests.size} test file(s) scanned\n`,
  );
  return 0;
}

/* c8 ignore start — CLI bootstrap; behavior covered by subprocess tests. */
async function main(): Promise<void> {
  const code = await run({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  });
  exit(code);
}

const invokedAsCli =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedAsCli) {
  main().catch((err) => {
    process.stderr.write(`lint-playwright-config: internal error: ${String(err)}\n`);
    exit(2);
  });
}
/* c8 ignore stop */
