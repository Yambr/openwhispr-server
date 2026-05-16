#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-no-prod-edit-with-test-only-pr.ts — Hard Rule §1 guard.
 *
 * Phase 21 / Plan 21-04 / SR-21.4.
 *
 * Enforces CLAUDE.md Hard Rule §1: "NEVER edit production server code to
 * make tests pass." Specifically:
 *
 *   If a PR title or body contains the `[test-fix]` tag AND the diff
 *   touches a file in any of the production-path globs, the linter
 *   exits non-zero with the offending file listed.
 *
 * The override label `[scope-expansion]` (also accepted in title or
 * body) lets a maintainer bypass the rule when a scope expansion was
 * explicitly authorized — in which case the body MUST explain the
 * rationale (the linter checks for label presence; humans review the
 * rationale in code review).
 *
 * This is a CI-only linter — locally, the lefthook pre-commit hook does
 * not have PR metadata (title/body) and the script no-ops. The required
 * GHA job feeds the title via `--title`, the body via `--body`, and
 * the changed-files list (one path per line) via `--files <path>`.
 *
 * Exit codes:
 *   0 — clean OR no PR context supplied (local invocation, lefthook-safe)
 *   1 — at least one offender
 *   2 — internal error (e.g. --files path unreadable)
 *
 * Usage in CI:
 *   gh pr view "${PR_NUMBER}" --json title,body -q '.title' > /tmp/title.txt
 *   gh pr view "${PR_NUMBER}" --json body  -q '.body'  > /tmp/body.txt
 *   gh pr diff "${PR_NUMBER}" --name-only > /tmp/changed.txt
 *   pnpm tsx tools/lint-no-prod-edit-with-test-only-pr.ts \
 *     --title "$(cat /tmp/title.txt)" \
 *     --body  "$(cat /tmp/body.txt)" \
 *     --files /tmp/changed.txt
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

export interface Offender {
  file: string;
  line: number;
  col: number;
  message: string;
}

/**
 * A path is a "production" path iff it matches one of these patterns AND
 * is not itself a test file. Test files inside production directories
 * (e.g. `apps/api/src/__tests__/foo.test.ts`) are exempt — those are
 * tests living alongside the code under test, and modifying them is
 * categorically a test-fix activity.
 */
const PROD_PATH_PATTERNS: readonly RegExp[] = [
  /^apps\/[^/]+\/src\//,
  /^packages\/[^/]+\/src\//,
  /^compose\/.+\.ya?ml$/,
  /^docker-compose\.ya?ml$/,
  /^charts\/openwhispr\/templates\//,
  /^Makefile$/,
];

const TEST_FILE_PATTERNS: readonly RegExp[] = [/\.(test|spec)\.tsx?$/, /\/__tests__\//];

const TEST_FIX_LABEL_RE = /\[test-fix\]/i;
const SCOPE_EXPANSION_LABEL_RE = /\[scope-expansion\]/i;

/** Predicate — is `path` a production path that the rule covers? */
export function isProductionPath(path: string): boolean {
  if (TEST_FILE_PATTERNS.some((re) => re.test(path))) return false;
  return PROD_PATH_PATTERNS.some((re) => re.test(path));
}

/** Detect `[test-fix]` (case-insensitive) anywhere in `text`. */
export function hasTestFixLabel(text: string): boolean {
  return TEST_FIX_LABEL_RE.test(text);
}

/** Detect `[scope-expansion]` override (case-insensitive) anywhere in `text`. */
export function hasScopeExpansionLabel(text: string): boolean {
  return SCOPE_EXPANSION_LABEL_RE.test(text);
}

/** Split a newline-separated `git diff --name-only`-style list. */
export function parseChangedFiles(body: string): string[] {
  return body
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface LintInput {
  title: string;
  body: string;
  changedFiles: readonly string[];
}

/** Core rule application. Returns one offender per production file. */
export function lintProductionEditsInTestFixPr(input: LintInput): Offender[] {
  const labelText = `${input.title}\n${input.body}`;
  if (!hasTestFixLabel(labelText)) return [];
  if (hasScopeExpansionLabel(labelText)) return [];
  const offenders: Offender[] = [];
  for (const file of input.changedFiles) {
    if (!isProductionPath(file)) continue;
    offenders.push({
      file,
      line: 1,
      col: 1,
      message: `[test-fix] PR touches production file ${file} — CLAUDE.md Hard Rule §1: "NEVER edit production server code to make tests pass". If this scope expansion is intentional, add the [scope-expansion] label with rationale in the PR body.`,
    });
  }
  return offenders;
}

export interface RunOptions {
  argv: readonly string[];
  cwd: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

interface ParsedArgs {
  title: string | null;
  body: string;
  filesPath: string | null;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let title: string | null = null;
  let body = "";
  let filesPath: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--title") {
      title = argv[i + 1] ?? null;
      i += 1;
    } else if (a === "--body") {
      body = argv[i + 1] ?? "";
      i += 1;
    } else if (a === "--files") {
      filesPath = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return { title, body, filesPath };
}

function reportOffenders(offenders: Offender[], stderr: (s: string) => void): void {
  stderr(`Production-edit-in-test-fix-PR lint violation: ${offenders.length} offender(s).\n`);
  for (const o of offenders) {
    stderr(`  ${o.file}:${o.line}:${o.col}  ${o.message}\n`);
  }
}

export async function run(opts: RunOptions): Promise<number> {
  const { argv, cwd, stdout, stderr } = opts;
  const { title, body, filesPath } = parseArgs(argv);

  // Local lefthook invocation has no PR metadata — no-op cleanly.
  if (title === null || filesPath === null) {
    stdout("lint-no-prod-edit: no PR context supplied — skipped (CI-only linter)\n");
    return 0;
  }

  let changedBody: string;
  try {
    changedBody = readFileSync(resolve(cwd, filesPath), "utf8");
  } catch (err) {
    stderr(`lint-no-prod-edit: internal error: ${String(err)}\n`);
    return 2;
  }
  const changedFiles = parseChangedFiles(changedBody);

  const offenders = lintProductionEditsInTestFixPr({ title, body, changedFiles });

  if (offenders.length > 0) {
    reportOffenders(offenders, stderr);
    return 1;
  }
  stdout(
    `Production-edit-in-test-fix-PR lint passed: ${changedFiles.length} changed file(s), label ${hasTestFixLabel(`${title}\n${body}`) ? "present" : "absent"}\n`,
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
    process.stderr.write(`lint-no-prod-edit: internal error: ${String(err)}\n`);
    exit(2);
  });
}
/* c8 ignore stop */
