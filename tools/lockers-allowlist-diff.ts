#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lockers-allowlist-diff.ts — Phase 31 / Plan 31-07 (LOCKER-09).
 *
 * CI helper: refuses net additions to any of the six locker allowlist files
 * unless the commit body or PR body carries an `Allowlist-grow-approved:
 * issue-NNNN` trailer.
 *
 * Behaviour:
 *
 *   1. Resolve the base ref. In CI we use `origin/$GITHUB_BASE_REF` (set by
 *      `actions/checkout` for PRs); locally we fall back to `HEAD~1`. The
 *      base can be overridden by the `BASE_REF` env var.
 *   2. For each of the six allowlist files, read its base-ref contents
 *      (`git show <ref>:<path>`) and its HEAD working-tree contents.
 *   3. Compute net additions: entries present at HEAD but absent at base.
 *      Pure removals + reorderings are allowed.
 *   4. If any net additions exist AND neither `COMMIT_MESSAGE` nor `PR_BODY`
 *      carries the approval trailer, exit 1 with a per-file summary on
 *      stderr. Otherwise exit 0.
 *
 * Exit codes:
 *   0 — clean OR net additions approved
 *   1 — net additions present without approval
 *   2 — internal error (git failed, file unreadable, etc.)
 *
 * The pure compute fns (`parseAllowlist`, `computeNetAdditions`,
 * `isApproved`, `run`) are exported for unit testing via DI seam —
 * `run()` takes pre-read allowlist contents, so the test suite never
 * spawns git.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { exit } from "node:process";

/** Canonical list of the six locker allowlist file paths (repo-relative). */
export const LOCKER_ALLOWLIST_FILES: readonly string[] = [
  "tools/lint-no-env-branches.allowlist.txt",
  "tools/lint-no-suppressions.allowlist.txt",
  "tools/lint-no-hardcode.allowlist.txt",
  "tools/lint-prod-readiness.allowlist.txt",
  "tools/lint-secret-shape-in-error.allowlist.txt",
  "tools/lint-shell-credential-interpolation.allowlist.txt",
] as const;

/**
 * Parse an allowlist file's text into a list of normalized `file:line` keys.
 * Drops blank lines, `#`-prefixed comments, and inline `# rationale`.
 */
export function parseAllowlist(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) continue;
    // Strip inline rationale after the first whitespace-followed-by-#.
    const hashIdx = trimmed.search(/\s+#/);
    const key = hashIdx === -1 ? trimmed : trimmed.slice(0, hashIdx).trim();
    if (key.length === 0) continue;
    out.push(key);
  }
  return out;
}

/**
 * Compute net additions: entries that appear in `headText` but not in
 * `baseText`. Pure removals + reorderings return `[]`.
 */
export function computeNetAdditions(baseText: string, headText: string): string[] {
  const baseSet = new Set(parseAllowlist(baseText));
  const headList = parseAllowlist(headText);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of headList) {
    if (baseSet.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Detect the `Allowlist-grow-approved: issue-NNNN` approval trailer in
 * either the commit message or PR body. The token MUST match the literal
 * `issue-` prefix + ≥1 digit; bare `Allowlist-grow-approved: yolo` is
 * rejected.
 */
export function isApproved(commitMessage: string, prBody: string): boolean {
  const re = /Allowlist-grow-approved:\s*issue-\d+/i;
  return re.test(commitMessage) || re.test(prBody);
}

/** Result of a single run() invocation (test-friendly shape). */
export interface RunResult {
  code: 0 | 1;
  netAdditions: Record<string, string[]>;
}

/** Per-file input shape for the DI seam. Maps allowlist-file → contents. */
export interface RunInput {
  baseAllowlists: Record<string, string>;
  headAllowlists: Record<string, string>;
  commitMessage: string;
  prBody: string;
}

/**
 * Pure runner: takes pre-read allowlist contents and returns
 * `{ code, netAdditions }`. The CLI wrapper spawns git to populate the
 * inputs; tests inject canned strings.
 */
export function run(input: RunInput): RunResult {
  const netAdditions: Record<string, string[]> = {};
  let hasNet = false;
  // Iterate the union of base + head keys so we catch:
  //   - new allowlist files (absent at base, present at head) → full-list addition
  //   - deleted allowlist files (present at base, absent at head) → no net add
  const allKeys = new Set<string>([
    ...Object.keys(input.baseAllowlists),
    ...Object.keys(input.headAllowlists),
  ]);
  for (const key of allKeys) {
    const baseText = input.baseAllowlists[key] ?? "";
    const headText = input.headAllowlists[key] ?? "";
    const added = computeNetAdditions(baseText, headText);
    if (added.length > 0) {
      netAdditions[key] = added;
      hasNet = true;
    }
  }
  if (!hasNet) return { code: 0, netAdditions };
  if (isApproved(input.commitMessage, input.prBody)) {
    return { code: 0, netAdditions };
  }
  return { code: 1, netAdditions };
}

/** Resolve the base ref. CI sets GITHUB_BASE_REF; local falls back to HEAD~1. */
export function resolveBaseRef(env: Record<string, string | undefined>): string {
  const override = env.BASE_REF;
  if (override && override.length > 0) return override;
  const ghBase = env.GITHUB_BASE_REF;
  if (ghBase && ghBase.length > 0) return `origin/${ghBase}`;
  return "HEAD~1";
}

/** Dependency-injection seam: returns the file's contents at a git ref, or "" if absent. */
export type ReadAtRef = (ref: string, path: string) => string;

/** Dependency-injection seam: returns the file's working-tree contents, or "" if absent. */
export type ReadAtHead = (path: string) => string;

/** Default ReadAtRef implementation backed by `git show <ref>:<path>`. */
export function defaultReadAtRef(repoRoot: string): ReadAtRef {
  return (ref: string, path: string): string => {
    try {
      return execFileSync("git", ["show", `${ref}:${path}`], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      return "";
    }
  };
}

/** Default ReadAtHead implementation backed by node:fs. */
export function defaultReadAtHead(repoRoot: string): ReadAtHead {
  return (path: string): string => {
    const abs = join(repoRoot, path);
    if (!existsSync(abs)) return "";
    return readFileSync(abs, "utf8");
  };
}

/** Output sink for runCli; tests inject a string-collector. */
export interface CliIo {
  writeStderr: (msg: string) => void;
  exit: (code: number) => never;
}

/** Inputs to the CLI runner with all I/O abstracted. */
export interface RunCliInput {
  files: readonly string[];
  baseRef: string;
  readAtRef: ReadAtRef;
  readAtHead: ReadAtHead;
  env: Record<string, string | undefined>;
  io: CliIo;
}

/**
 * Run the CLI shape: read all base+head allowlists via the injected
 * readers, call `run()`, write a stderr summary, call `io.exit(code)`.
 * The function never returns (io.exit is `never`-typed).
 */
export function runCli(input: RunCliInput): never {
  const baseAllowlists: Record<string, string> = {};
  const headAllowlists: Record<string, string> = {};
  for (const path of input.files) {
    baseAllowlists[path] = input.readAtRef(input.baseRef, path);
    headAllowlists[path] = input.readAtHead(path);
  }
  const commitMessage = input.env.COMMIT_MESSAGE ?? "";
  const prBody = input.env.PR_BODY ?? "";
  const result = run({ baseAllowlists, headAllowlists, commitMessage, prBody });
  if (result.code === 0) {
    const total = Object.values(result.netAdditions).reduce((n, arr) => n + arr.length, 0);
    if (total > 0) {
      input.io.writeStderr(
        `lockers-allowlist-diff: ${total} net addition(s) approved via Allowlist-grow-approved trailer\n`,
      );
    } else {
      input.io.writeStderr("lockers-allowlist-diff: clean (no net additions)\n");
    }
    return input.io.exit(0);
  }
  input.io.writeStderr(
    "lockers-allowlist-diff: REFUSED — net allowlist additions without approval trailer.\n",
  );
  input.io.writeStderr(
    "Resolution: add 'Allowlist-grow-approved: issue-NNNN' to the commit body or PR description; reference the tracking issue.\n",
  );
  for (const [file, additions] of Object.entries(result.netAdditions)) {
    input.io.writeStderr(`\n  ${file}: ${additions.length} net addition(s)\n`);
    for (const a of additions) {
      input.io.writeStderr(`    + ${a}\n`);
    }
  }
  return input.io.exit(1);
}

/* c8 ignore start — process-coupled CLI wiring, exercised via the
   `tsx tools/lockers-allowlist-diff.ts` CLI entry below and not unit-
   testable without forking the vitest worker. The behaviour is covered
   end-to-end by `tests/e2e/lockers.test.ts`'s allowlist-diff integration
   path (Phase 31 / Plan 31-07 e2e suite). */
/** Default CLI I/O — writes to process.stderr; exits via node:process.exit. */
export function defaultCliIo(): CliIo {
  return {
    writeStderr: (m: string) => {
      process.stderr.write(m);
    },
    exit: (code: number) => {
      exit(code);
      throw new Error("unreachable after process.exit");
    },
  };
}
/* c8 ignore stop */

// CLI entry — execute runCli with the default I/O wiring only when this
// module is invoked directly via `tsx tools/lockers-allowlist-diff.ts`.
// Importing as a module for tests must NOT spawn git or call exit.
const invokedAsCli =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  /lockers-allowlist-diff\.ts$/.test(process.argv[1]);
/* c8 ignore start — CLI bootstrap branch executed only via tsx CLI */
if (invokedAsCli) {
  const repoRoot = resolve(process.cwd());
  runCli({
    files: LOCKER_ALLOWLIST_FILES,
    baseRef: resolveBaseRef(process.env),
    readAtRef: defaultReadAtRef(repoRoot),
    readAtHead: defaultReadAtHead(repoRoot),
    env: process.env,
    io: defaultCliIo(),
  });
}
/* c8 ignore stop */
