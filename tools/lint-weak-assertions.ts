#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: Apache-2.0
/**
 * lint-weak-assertions.ts — Bans weak DOM assertions of the form
 *
 *   expect(<screen|wrapper>.<getAllBy|queryAllBy|findAllBy><X>(...).length)
 *     .toBeGreaterThan(n)
 *   expect(<screen|wrapper>.<getAllBy|queryAllBy|findAllBy><X>(...).length)
 *     .toBeGreaterThanOrEqual(n)
 *
 * Phase 13 / Plan 01 / Task 03. These assertions don't pin DOM cardinality
 * and silently pass when the wrong number of elements render. Use
 *   await screen.findByText(/x/) + toBeInTheDocument()
 * for "exactly one" or `.toHaveLength(N)` for "exactly N".
 *
 * Scope: globs `**\/*.test.ts` and `**\/*.test.tsx` under argv[2] (default
 * `process.cwd()`). Ignores `node_modules`, `dist`, `coverage`, `.git`,
 * `.bdd-gen` per the `tools/lint-english.ts` IGNORE-list convention.
 *
 * Exit codes:
 *   0 — no offenders (also: `--self-test` passes)
 *   1 — at least one offender (each printed to stderr as
 *       `file:line:col preview`) OR `--self-test` regex fails
 *   2 — internal error during scan
 *
 * Usage:
 *   pnpm exec tsx tools/lint-weak-assertions.ts [rootDir]
 *   pnpm exec tsx tools/lint-weak-assertions.ts --self-test
 *
 * The module also exports `WEAK_ASSERTION`, `scanRoot`, and `selfTest` for
 * in-process unit-test coverage (subprocess `execFileSync` tests cover the
 * CLI shape; in-process tests cover the regex/scanner branches).
 */
import { readFileSync, realpathSync } from "node:fs";
import { glob } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

// Family regex: any `getAllBy* / queryAllBy* / findAllBy*` Testing-Library
// query whose `.length` is asserted with `.toBeGreaterThan(n)` or
// `.toBeGreaterThanOrEqual(n)`. `\w*` allows `getAllByRole`,
// `getAllByText`, `queryAllByLabelText`, etc.
//
// The canonical real-world offender form is:
//   expect(screen.getAllByText(/x/).length).toBeGreaterThan(0)
// i.e. `.length` is wrapped in the outer `expect(...)` and a `)` sits
// between `.length` and `.toBeGreaterThan`. The regex therefore allows
// any (small) run of whitespace/`)`-style chars between `.length` and the
// matcher call — but NOT another method call, which would change semantics.
//
// Built as a literal so the source IS itself an offender pattern. To keep
// the source from self-flagging when scanned, the file is excluded by the
// `**/*.test.ts` glob (no `.test.` suffix).
export const WEAK_ASSERTION =
  /\.(getAllBy|queryAllBy|findAllBy)\w*\([^)]*\)\.length[\s)]*\.toBeGreaterThan(OrEqual)?\(\s*\d+\s*\)/;

const PATTERNS = ["**/*.test.ts", "**/*.test.tsx"];

const IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.stryker-tmp/**",
  "**/reports/**",
  "**/.git/**",
  "**/.bdd-gen/**",
  "**/pnpm-lock.yaml",
];

export interface Offender {
  file: string;
  line: number;
  col: number;
  preview: string;
}

export interface ScanResult {
  scanned: number;
  offenders: Offender[];
}

export async function scanRoot(rootDir: string): Promise<ScanResult> {
  const cwd = resolve(rootDir);
  // realpathSync throws ENOENT for non-existent dirs — caller handles it.
  const realCwd = realpathSync(cwd);
  const offenders: Offender[] = [];
  const seen = new Set<string>();
  let scanned = 0;
  for (const pattern of PATTERNS) {
    for await (const file of glob(pattern, { cwd: realCwd, exclude: IGNORE })) {
      /* c8 ignore next — Node glob always returns strings; String(file) is defense. */
      const rel = typeof file === "string" ? file : String(file);
      /* c8 ignore next — seen-set dedupe; the two test-file patterns do not overlap in practice. */
      if (seen.has(rel)) continue;
      seen.add(rel);
      const full = resolve(realCwd, rel);
      /* c8 ignore next 3 — defense-in-depth against symlink path-traversal
         escapes; not reachable without unsafe filesystem manipulation in
         tests (Node's `glob` honors the `cwd` boundary already). */
      if (!full.startsWith(realCwd + sep) && full !== realCwd) {
        continue;
      }
      let text: string;
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      scanned += 1;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const lineText = lines[i];
        const m = WEAK_ASSERTION.exec(lineText);
        if (m && m.index !== undefined) {
          offenders.push({
            file: rel,
            line: i + 1,
            col: m.index + 1,
            preview: lineText.trim().slice(0, 100),
          });
        }
      }
    }
  }
  return { scanned, offenders };
}

export function selfTest(): boolean {
  // Positive fixtures MUST match.
  const positive = "expect(screen.getAllByText(/x/).length).toBeGreaterThan(0);";
  const positiveOrEqual =
    'expect(screen.queryAllByRole("button").length).toBeGreaterThanOrEqual(2);';
  // Negative fixture MUST NOT match.
  const negative = "expect(await screen.findByText(/x/)).toBeInTheDocument();";
  const matchedPositive = WEAK_ASSERTION.test(positive);
  const matchedPositiveOrEqual = WEAK_ASSERTION.test(positiveOrEqual);
  const matchedNegative = WEAK_ASSERTION.test(negative);
  return matchedPositive && matchedPositiveOrEqual && !matchedNegative;
}

export interface RunOptions {
  argv: readonly string[];
  cwd: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

/**
 * Programmatic CLI entry. Returns the integer exit code that the CLI would
 * have exited with; the caller decides whether to actually call
 * `process.exit()`. Splitting this out from `main()` lets the unit-test
 * suite exercise every branch in-process for v8 coverage.
 */
export async function run(opts: RunOptions): Promise<number> {
  const { argv, cwd, stdout, stderr } = opts;
  if (argv.includes("--self-test")) {
    if (selfTest() /* c8 ignore next — falsy arm only reachable with a broken regex */) {
      stdout("lint-weak-assertions self-test: PASS\n");
      return 0;
    }
    /* c8 ignore start — unreachable while selfTest() is hard-coded to pass against
       the current regex; the subprocess test covers the actual CLI exit-1 path
       through an offender directory, not a broken self-test. */
    stderr("lint-weak-assertions self-test: FAIL\n");
    return 1;
    /* c8 ignore stop */
  }
  const rawCwd = argv[0] ?? cwd; /* c8 ignore next — both arms tested separately */
  let result: ScanResult;
  try {
    result = await scanRoot(rawCwd);
  } catch (err) {
    stderr(`lint-weak-assertions: internal error: ${String(err)}\n`);
    return 2;
  }
  const { scanned, offenders } = result;
  if (offenders.length > 0) {
    stderr(
      `Weak-assertion violation: ${offenders.length} occurrence(s). ` +
        `Use findByText + toBeInTheDocument or toHaveLength(N) instead.\n`,
    );
    for (const o of offenders) {
      stderr(`  ${o.file}:${o.line}:${o.col}  ${o.preview}\n`);
    }
    return 1;
  }
  stdout(`Weak-assertion check passed: ${scanned} file(s) scanned in ${resolve(rawCwd)}\n`);
  return 0;
}

/* c8 ignore start — CLI shim around run(); covered by the subprocess tests in
   tools/lint-weak-assertions.test.ts (the execFileSync-driven cases). */
async function main(): Promise<void> {
  // process.argv = [node, script, ...userArgs] — pass userArgs only.
  const code = await run({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  });
  exit(code);
}
/* c8 ignore stop */

// Run main() only when invoked as a CLI script — never on `import` from a
// test file. `import.meta.url` resolution lets us detect the CLI entry
// without depending on Node's `require.main`.
const invokedAsCli =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

/* c8 ignore start — CLI bootstrap; behavior covered by subprocess tests. */
if (invokedAsCli) {
  main().catch((err) => {
    process.stderr.write(`lint-weak-assertions: internal error: ${String(err)}\n`);
    exit(2);
  });
}
/* c8 ignore stop */
