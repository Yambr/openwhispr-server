#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-coverage-floor-per-phase.ts — strict 90/90/90/90 enforcement.
 *
 * Phase 21 / Plan 21-05 / SR-21.5.
 *
 * The project's global vitest threshold is 85/80/80/85, but PROJECT.md
 * mandates 90/90/90/90 (lines/branches/functions/statements) per file
 * inside the strict-coverage packages. This linter enforces that floor
 * against the diff of the current PR — every file that BOTH (a) appears
 * in the changed-files list and (b) sits inside a strict package MUST
 * carry ≥ 90% on every axis in `coverage-summary.json`.
 *
 * The seven strict packages (per PROJECT.md constitutional rule 2):
 *   - apps/api
 *   - apps/web
 *   - apps/worker
 *   - packages/data
 *   - packages/byok-guard
 *   - packages/email
 *   - packages/litellm-client
 *
 * Inputs:
 *   --summary <path>   vitest v8 coverage-summary.json (default: coverage/coverage-summary.json)
 *   --changed <path>   newline-separated list of changed files (default: empty → skip)
 *
 * Exit codes:
 *   0 — clean OR no coverage summary yet (first run; skipped cleanly)
 *   1 — at least one offender
 *   2 — internal error
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

export interface Offender {
  file: string;
  line: number;
  col: number;
  message: string;
}

/** The 7 strict packages from PROJECT.md constitutional rule 2. */
export const STRICT_PACKAGE_PATTERNS: readonly RegExp[] = [
  /\/apps\/api\/src\//,
  /\/apps\/web\/src\//,
  /\/apps\/worker\/src\//,
  /\/packages\/data\/src\//,
  /\/packages\/byok-guard\/src\//,
  /\/packages\/email\/src\//,
  /\/packages\/litellm-client\/src\//,
];

const TEST_FILE_RE = /(\.(?:test|spec)\.tsx?|\/__tests__\/)/;
const FLOOR = 90;

interface AxisEntry {
  pct?: number;
}
interface CoverageEntry {
  statements: AxisEntry;
  branches: AxisEntry;
  functions: AxisEntry;
  lines: AxisEntry;
}

/** Predicate — does the absolute or relative path belong to a strict package? */
export function isStrictPath(path: string): boolean {
  if (TEST_FILE_RE.test(path)) return false;
  return STRICT_PACKAGE_PATTERNS.some((re) => re.test(`/${path.replace(/^\/+/, "")}`));
}

/**
 * Evaluate one coverage entry. Returns one Offender per failing axis.
 * Missing axes are treated as 0 (i.e. they count as offenders).
 */
export function evaluateCoverageEntry(file: string, entry: CoverageEntry): Offender[] {
  const offenders: Offender[] = [];
  const axes: Array<[keyof CoverageEntry, string]> = [
    ["statements", "statements"],
    ["branches", "branches"],
    ["functions", "functions"],
    ["lines", "lines"],
  ];
  for (const [key, label] of axes) {
    const pct = entry?.[key]?.pct;
    if (typeof pct !== "number" || pct < FLOOR) {
      const reported = typeof pct === "number" ? pct : 0;
      offenders.push({
        file,
        line: 1,
        col: 1,
        message: `${label} coverage ${reported}% < ${FLOOR}% strict floor (PROJECT.md constitutional rule 2)`,
      });
    }
  }
  return offenders;
}

/** Parse coverage-summary.json; return null if absent or invalid. */
export function loadCoverageSummary(path: string): Record<string, CoverageEntry> | null {
  try {
    statSync(path);
  } catch {
    return null;
  }
  try {
    const body = readFileSync(path, "utf8");
    return JSON.parse(body) as Record<string, CoverageEntry>;
  } catch {
    return null;
  }
}

/** Load a newline-separated changed-files list; trims + filters blanks. */
export function loadChangedFiles(path: string): string[] {
  try {
    const body = readFileSync(path, "utf8");
    return body
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

export interface RunOptions {
  argv: readonly string[];
  cwd: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

interface ParsedArgs {
  summaryPath: string;
  changedPath: string | null;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let summaryPath = "coverage/coverage-summary.json";
  let changedPath: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--summary") {
      summaryPath = argv[i + 1] ?? summaryPath;
      i += 1;
    } else if (a === "--changed") {
      changedPath = argv[i + 1] ?? changedPath;
      i += 1;
    }
  }
  return { summaryPath, changedPath };
}

function reportOffenders(offenders: Offender[], stderr: (s: string) => void): void {
  stderr(`Coverage-floor lint violation: ${offenders.length} offender(s).\n`);
  for (const o of offenders) {
    stderr(`  ${o.file}:${o.line}:${o.col}  ${o.message}\n`);
  }
}

/** Match a changed-file (repo-relative) to an entry-key (often absolute). */
function findCoverageEntry(
  summary: Record<string, CoverageEntry>,
  changedRel: string,
): { absKey: string; entry: CoverageEntry } | null {
  for (const key of Object.keys(summary)) {
    if (key === "total") continue;
    if (key.endsWith(`/${changedRel}`) || key === changedRel) {
      return { absKey: key, entry: summary[key] };
    }
  }
  return null;
}

export async function run(opts: RunOptions): Promise<number> {
  const { argv, cwd, stdout, stderr } = opts;
  const { summaryPath, changedPath } = parseArgs(argv);
  const summaryAbs = resolve(cwd, summaryPath);
  const summary = loadCoverageSummary(summaryAbs);
  if (summary === null) {
    stdout("Coverage-floor lint: no coverage summary present — skipped\n");
    return 0;
  }

  const changedFiles = changedPath !== null ? loadChangedFiles(resolve(cwd, changedPath)) : [];
  if (changedFiles.length === 0) {
    stdout("Coverage-floor lint: no changed files supplied — skipped\n");
    return 0;
  }

  const offenders: Offender[] = [];
  for (const rel of changedFiles) {
    if (!isStrictPath(rel)) continue;
    const found = findCoverageEntry(summary, rel);
    if (found === null) {
      offenders.push({
        file: rel,
        line: 1,
        col: 1,
        message: `strict-package file has no entry in coverage-summary.json — run \`pnpm test --coverage\` and re-check`,
      });
      continue;
    }
    offenders.push(...evaluateCoverageEntry(rel, found.entry));
  }

  if (offenders.length > 0) {
    reportOffenders(offenders, stderr);
    return 1;
  }
  stdout(`Coverage-floor lint passed: ${changedFiles.length} changed file(s) scanned\n`);
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
    process.stderr.write(`lint-coverage-floor: internal error: ${String(err)}\n`);
    exit(2);
  });
}
/* c8 ignore stop */
