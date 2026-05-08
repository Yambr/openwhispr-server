#!/usr/bin/env -S pnpm exec tsx
/**
 * lint-tdd.ts — Advisory TDD commit-order heuristic.
 *
 * Inspects the current PR's commit series (or `git log` between baseRef
 * and headRef) and flags commits that modify production source files
 * BEFORE any commit in the series modifies a `*.test.ts` file.
 *
 * Phase 0 policy: ADVISORY ONLY. The CI job that runs this script is
 * configured with `continue-on-error: true` (Plan 04). Promotion to a
 * blocking check is deferred to Phase 2+ once the heuristic has been
 * exercised against real PRs.
 *
 * Exit codes:
 *   0 — no violations
 *   1 — at least one violation; details printed to stderr (advisory)
 *   2 — internal error (could not read git log)
 *
 * Env:
 *   GITHUB_BASE_REF — base branch name (default: "main")
 *   GITHUB_SHA      — head SHA (default: "HEAD")
 */
import { execFileSync } from 'node:child_process';
import { exit } from 'node:process';

const baseRef = process.env.GITHUB_BASE_REF ?? 'main';
const headRef = process.env.GITHUB_SHA ?? 'HEAD';

interface Violation {
  sha: string;
  files: string[];
}

function gitLog(range: string): string {
  return execFileSync(
    'git',
    ['log', '--reverse', '--name-only', '--format=%H', range],
    { encoding: 'utf8' },
  );
}

function parseBlocks(log: string): { sha: string; files: string[] }[] {
  // git log output with --format=%H + --name-only emits:
  //   <sha>\n<file>\n<file>\n\n<sha>\n<file>\n...
  // Split on a blank line followed by a 40-char hex sha.
  const out: { sha: string; files: string[] }[] = [];
  const lines = log.split('\n');
  let current: { sha: string; files: string[] } | null = null;
  for (const line of lines) {
    if (/^[a-f0-9]{40}$/.test(line)) {
      if (current) out.push(current);
      current = { sha: line, files: [] };
    } else if (line && current) {
      current.files.push(line);
    }
  }
  if (current) out.push(current);
  return out;
}

function isTestFile(file: string): boolean {
  return /\.test\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file);
}

function isProductionFile(file: string): boolean {
  // Production source: apps/<x>/src/** or packages/<x>/src/**, excluding tests.
  return /^(apps|packages)\/[^/]+\/src\/.+\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)
    && !isTestFile(file);
}

function detectRange(): string {
  // Prefer origin/baseRef..headRef; fall back to baseRef..headRef when running
  // locally without a fetched origin remote.
  const candidates = [`origin/${baseRef}..${headRef}`, `${baseRef}..${headRef}`];
  for (const r of candidates) {
    try {
      execFileSync('git', ['rev-parse', '--verify', r.split('..')[0]], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      return r;
    } catch {
      // Try next candidate.
    }
  }
  // Last resort: empty range.
  return `${headRef}..${headRef}`;
}

function main(): void {
  let log: string;
  try {
    log = gitLog(detectRange());
  } catch (err) {
    process.stderr.write(`lint-tdd: error inspecting git log: ${String(err)}\n`);
    exit(2);
    return;
  }

  const blocks = parseBlocks(log);
  let sawTestCommit = false;
  const violations: Violation[] = [];

  for (const block of blocks) {
    const isTest = block.files.some(isTestFile);
    const prodFiles = block.files.filter(isProductionFile);
    if (isTest) sawTestCommit = true;
    if (!sawTestCommit && prodFiles.length > 0) {
      violations.push({ sha: block.sha, files: prodFiles });
    }
  }

  if (violations.length > 0) {
    process.stderr.write(
      `TDD heuristic: production-code commit(s) preceded any test commit:\n`,
    );
    for (const v of violations) {
      process.stderr.write(`  ${v.sha} -> ${v.files.join(', ')}\n`);
    }
    process.stderr.write(
      'Advisory only (non-blocking in Phase 0); promote to blocking in Phase 2+.\n',
    );
    exit(1);
    return;
  }

  process.stdout.write(
    `TDD heuristic passed: ${blocks.length} commit(s) inspected, no violations.\n`,
  );
}

main();
