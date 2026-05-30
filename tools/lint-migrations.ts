#!/usr/bin/env tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-migrations.ts — squawk PR gate driver (DEPLOY-04).
 *
 * Enumerates new SQL files in `drizzle/**\/*.sql` since a git ref, pipes each
 * through `squawk-cli` with the default rule set, then post-filters the
 * JSON diagnostics to a tight allowlist of *blocking* rules (online-migration
 * safety; everything else is ignored). Exits nonzero on any blocking finding.
 *
 * Usage:
 *   tsx tools/lint-migrations.ts --since origin/main
 *   tsx tools/lint-migrations.ts -- tools/fixtures/migrations/bad-blocking-index.sql
 *
 * Per CLAUDE.md "no internal mocks" rule: tests mock only the
 * `child_process.execFileSync` boundary (squawk binary + git).
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// Pinned squawk-cli EXACT version. v2.52+ adopted --exclude/--include semantics
// (no positional --rules allowlist), so we run with defaults and filter the JSON
// output ourselves to the blocking-rule allowlist below. Pinned to an exact
// patch (not the floating `2` major) because `npx squawk-cli@2` resolves to the
// latest 2.x at fetch time, and CI's resolution drifted to a 2.x whose JSON
// output differed enough that the bad-* fixtures stopped tripping the blocking
// rules — the integration tests then saw exit 0 where they expect 1 (green
// locally on 2.55.0, red in CI on a drifted resolve). An exact pin makes the
// gate deterministic across CI and dev. Bump deliberately when adopting a new
// squawk.
const SQUAWK_VERSION = "2.55.0";

// Blocking rules — anything in this list causes the PR gate to fail.
// Per Plan 09-02 interfaces + 09-RESEARCH §"Online-Migration Lint".
// Everything else squawk emits (require-timeout-settings, prefer-robust-stmts,
// pg-extensions, ...) is treated as info — useful in editor, not in CI gate.
export const BLOCKING_RULES = new Set([
  "adding-required-field",
  "ban-drop-column",
  "ban-drop-database",
  "ban-drop-not-null",
  "ban-drop-table",
  "changing-column-type",
  "constraint-missing-not-valid",
  "disallowed-unique-constraint",
  "prefer-big-int",
  "prefer-bigint-over-int",
  "prefer-text-field",
  "renaming-column",
  "renaming-table",
  "require-concurrent-index-creation",
  "require-concurrent-index-deletion",
  "transaction-nesting",
]);

export interface Argv {
  since?: string;
  exclude: string[];
  files: string[];
}

export function parseArgs(rawArgs: string[]): Argv {
  const out: Argv = { exclude: [], files: [] };
  let inFiles = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (inFiles) {
      out.files.push(a);
      continue;
    }
    if (a === "--") {
      inFiles = true;
      continue;
    }
    if (a === "--since") {
      out.since = rawArgs[++i];
      continue;
    }
    if (a === "--exclude") {
      out.exclude = rawArgs[++i]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }
    if (a.endsWith(".sql")) {
      out.files.push(a);
    }
  }
  return out;
}

/**
 * Enumerate new SQL files added between `since` ref and HEAD.
 * Restricted to drizzle/**\/*.sql (the canonical migration directory).
 */
/* c8 ignore next 3 — default runner is the real execFileSync; tested via integration with the real binary in main() tests */
const defaultGitRunner = (cmd: string, args: string[]): string =>
  execFileSync(cmd, args, { encoding: "utf8" });

export function enumerateNewMigrations(
  since: string,
  runner: (cmd: string, args: string[]) => string = defaultGitRunner,
): string[] {
  try {
    const out = runner("git", [
      "diff",
      "--name-only",
      "--diff-filter=A",
      `${since}...HEAD`,
      "--",
      "drizzle/**/*.sql",
    ]);
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.endsWith(".sql"));
  } catch {
    return [];
  }
}

export interface SquawkDiagnostic {
  file?: string;
  line?: number;
  rule_name?: string;
  level?: string;
  message?: string;
  help?: string;
}

export type SquawkResult = {
  all: SquawkDiagnostic[];
  blocking: SquawkDiagnostic[];
  status: number;
  raw: string;
};

/**
 * Run squawk over a single SQL file. Returns parsed JSON diagnostics
 * AND a filtered subset matching BLOCKING_RULES. Filter is applied here
 * (not inside squawk) because squawk v2.x lacks an allowlist flag.
 */
/* c8 ignore start — default runner is the real squawk binary; integration-tested via main() */
const defaultSquawkRunner = (cmd: string, args: string[]): { stdout: string; status: number } => {
  try {
    const stdout = execFileSync(cmd, args, { encoding: "utf8" });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; status: number | null };
    const stdout = typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString() ?? "");
    return { stdout, status: e.status ?? 1 };
  }
};
/* c8 ignore stop */

/**
 * Extract squawk's JSON diagnostics array from possibly-contaminated stdout.
 *
 * `npx --yes` may wrap squawk's output with install notices on stdout; we
 * slice from the first `[` to the last `]` and parse that. Returns `[]` when
 * no balanced array is present (genuine crash / non-JSON), so `status` alone
 * drives the exit decision in that case.
 */
function extractDiagnostics(stdout: string): SquawkDiagnostic[] {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  const candidate = stdout.slice(start, end + 1);
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return Array.isArray(parsed) ? (parsed as SquawkDiagnostic[]) : [];
  } catch {
    return [];
  }
}

export function runSquawkOnFile(
  file: string,
  excludeRules: string[] = [],
  runner: (cmd: string, args: string[]) => { stdout: string; status: number } = defaultSquawkRunner,
): SquawkResult {
  const args = [
    "--yes",
    `squawk-cli@${SQUAWK_VERSION}`,
    "--pg-version",
    "17",
    "--reporter",
    "json",
  ];
  if (excludeRules.length) {
    args.push("--exclude", excludeRules.join(","));
  }
  args.push(file);

  const { stdout, status } = runner("npx", args);
  const trimmed = stdout.trim();
  // squawk's JSON array can arrive contaminated by the `npx --yes` wrapper:
  // on a cold/forked runner npx may prepend a package-install notice
  // ("npm warn exec …" / "added 1 package in 1s") or append a trailing
  // notice to STDOUT around the array. A naive `JSON.parse(trimmed)` throws
  // on that noise → empty diagnostics → blocking fixtures slip through as
  // exit 0 (the real #15 CI flake; cold-fetch hypothesis disproven — see
  // .planning/debug/squawk-gate-vitest-fork-empty-output-2026-05-30.md).
  // Extract the JSON array from the first `[` to the last `]` and parse that.
  const all = extractDiagnostics(trimmed);
  const blocking = all.filter((d) => d.rule_name && BLOCKING_RULES.has(d.rule_name));
  return { all, blocking, status, raw: trimmed };
}

/** Aggregate blocking diagnostics into a final exit code + summary string. */
export function aggregate(perFile: Array<{ file: string; result: SquawkResult }>): {
  exitCode: number;
  summary: string;
} {
  let exitCode = 0;
  const lines: string[] = [];
  for (const { file, result } of perFile) {
    if (result.status > 1) {
      // status==1 is "diagnostics emitted"; status>1 means squawk itself crashed.
      exitCode = 1;
      lines.push(`✗ ${file} — squawk error (exit ${result.status})`);
      if (result.raw) {
        lines.push(`    ${result.raw.slice(0, 200)}`);
      }
      continue;
    }
    if (result.blocking.length > 0) {
      exitCode = 1;
      lines.push(`✗ ${file}`);
      for (const d of result.blocking) {
        lines.push(`    [${d.rule_name ?? "?"}] line ${d.line ?? "?"}: ${d.message ?? ""}`);
        if (d.help) lines.push(`        help: ${d.help}`);
      }
    } else {
      lines.push(`✓ ${file}`);
    }
  }
  return {
    exitCode,
    summary: lines.length === 0 ? "No new migrations to lint." : lines.join("\n"),
  };
}

/** Surface DROP COLUMN / DROP TABLE as warnings (pitfall #9). */
export function scanForDropWarnings(file: string, read: (f: string) => string): string[] {
  const text = read(file).toUpperCase();
  const warnings: string[] = [];
  if (/\bDROP\s+COLUMN\b/.test(text)) {
    warnings.push(`${file}: DROP COLUMN detected — confirm contract phase (N+2 dance, pitfall #9)`);
  }
  if (/\bDROP\s+TABLE\b/.test(text)) {
    warnings.push(`${file}: DROP TABLE detected — confirm contract phase (pitfall #9)`);
  }
  return warnings;
}

/** CLI entry. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const files = [...args.files];

  if (args.since) {
    files.push(...enumerateNewMigrations(args.since));
  }

  const unique = Array.from(new Set(files)).filter((f) => existsSync(f));

  if (unique.length === 0) {
    process.stdout.write("No new migrations to lint.\n");
    return 0;
  }

  const perFile = unique.map((file) => ({
    file,
    result: runSquawkOnFile(file, args.exclude),
  }));
  const { exitCode, summary } = aggregate(perFile);
  process.stdout.write(summary + "\n");

  const fs = await import("node:fs");
  for (const file of unique) {
    const warnings = scanForDropWarnings(file, (f) => fs.readFileSync(f, "utf8"));
    for (const w of warnings) {
      process.stderr.write(`WARNING: ${w}\n`);
    }
  }
  return exitCode;
}

/* c8 ignore start */
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().then((code) => process.exit(code));
}
/* c8 ignore stop */
