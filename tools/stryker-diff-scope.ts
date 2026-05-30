// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * stryker-diff-scope.ts — compute the Stryker `--mutate` scope from a PR diff.
 *
 * ROOT CAUSE (260530-rqk follow-up): `mutation-quick` ran `stryker run
 * --incremental` with the config's full `mutate` globs (apps/api/src,
 * packages/{auth,data,litellm-client}/src). On a cold incremental cache — which
 * every PR hits the first time, because the cache key is keyed on the hash of
 * pnpm-lock.yaml + vitest.config.ts + stryker.config.json — Stryker mutates ALL
 * four packages = thousands of mutants = 68+ minutes. That is not "quick"; it is
 * a full mutation run wearing an incremental flag. A PR that touches only docs
 * or CI YAML should produce ZERO mutants and finish in seconds.
 *
 * The real fix is to mutate only the source files the PR actually changed. This
 * module computes that set: it diffs the PR's merge base against HEAD, keeps
 * only files inside the configured `mutate` source roots that survive the
 * config's negation patterns (no *.test.ts / *.spec.ts / *.gen.ts), and returns
 * them as an explicit file list to hand Stryker via repeated `--mutate <glob>`
 * args. Empty set → caller skips Stryker entirely (exit 0, nothing to mutate).
 *
 * Pure functions (parsing, filtering, glob-root derivation) are unit-tested
 * against fixtures; the thin git invocation is argv-array `spawnSync` with no
 * shell interpolation (LOCKER-06).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface StrykerMutateConfig {
  /** Positive source globs, e.g. "apps/api/src/**\/*.ts". */
  readonly includeGlobs: readonly string[];
  /** Negation globs (without leading "!"), e.g. "**\/*.test.ts". */
  readonly excludeGlobs: readonly string[];
}

/**
 * Split the config's `mutate` array into positive include globs and the
 * negation (leading-"!") globs, with the "!" stripped.
 */
export function parseMutateConfig(mutate: readonly string[]): StrykerMutateConfig {
  const includeGlobs: string[] = [];
  const excludeGlobs: string[] = [];
  for (const entry of mutate) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (entry.startsWith("!")) {
      excludeGlobs.push(entry.slice(1));
    } else {
      includeGlobs.push(entry);
    }
  }
  return { includeGlobs, excludeGlobs };
}

/**
 * Derive the source-root prefixes from the positive include globs. A glob
 * "apps/api/src/**\/*.ts" yields the prefix "apps/api/src/". Only the portion
 * before the first glob metacharacter (`*`, `?`, `[`, `{`) is kept, then
 * trimmed back to the last "/" so it is always a directory prefix.
 */
export function sourceRootsFromIncludes(includeGlobs: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const glob of includeGlobs) {
    const meta = glob.search(/[*?[{]/);
    const literal = meta === -1 ? glob : glob.slice(0, meta);
    const slash = literal.lastIndexOf("/");
    if (slash === -1) continue;
    roots.add(literal.slice(0, slash + 1));
  }
  return [...roots].sort();
}

/** True if `file` ends with one of the negation glob suffixes (e.g. ".test.ts"). */
export function isExcluded(file: string, excludeGlobs: readonly string[]): boolean {
  for (const glob of excludeGlobs) {
    // Config negations are all of the shape "**/*.<suffix>" — match on suffix.
    const star = glob.lastIndexOf("*");
    const suffix = star === -1 ? glob : glob.slice(star + 1);
    if (suffix.length > 0 && file.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * Intersect the changed-file list with the mutate config: keep only `.ts`
 * files that live under a source root AND are not excluded by a negation glob.
 * Returns a sorted, de-duplicated list of repo-relative paths.
 */
export function scopeChangedFiles(
  changedFiles: readonly string[],
  config: StrykerMutateConfig,
): string[] {
  const roots = sourceRootsFromIncludes(config.includeGlobs);
  const kept = new Set<string>();
  for (const raw of changedFiles) {
    const file = raw.trim();
    if (file.length === 0) continue;
    if (!file.endsWith(".ts")) continue;
    if (isExcluded(file, config.excludeGlobs)) continue;
    if (!roots.some((root) => file.startsWith(root))) continue;
    kept.add(file);
  }
  return [...kept].sort();
}

/** Parse the NUL/newline-separated `git diff --name-only` output into a list. */
export function parseGitDiffNames(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Load the `mutate` array from stryker.config.json at `repoRoot`. */
export function loadMutateFromConfig(repoRoot: string): string[] {
  const cfgPath = join(repoRoot, "stryker.config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as { mutate?: unknown };
  if (!Array.isArray(cfg.mutate)) {
    throw new Error("stryker.config.json: `mutate` is missing or not an array");
  }
  return cfg.mutate.filter((m): m is string => typeof m === "string");
}

/**
 * Run `git diff --name-only <base>...HEAD` (three-dot: changes on HEAD since the
 * merge base) via argv-array spawnSync — no shell, no credential interpolation
 * (LOCKER-06). Returns the changed-file list. Throws on git failure.
 */
export function changedFilesSinceBase(baseRef: string, repoRoot: string): string[] {
  const res = spawnSync("git", ["diff", "--name-only", `${baseRef}...HEAD`], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (res.status !== 0) {
    throw new Error(`git diff failed (status ${String(res.status)}): ${res.stderr ?? ""}`);
  }
  return parseGitDiffNames(res.stdout ?? "");
}

/**
 * Full pipeline: given a base ref + repo root, return the mutate-scoped file
 * list for this PR. Empty array means "nothing to mutate".
 */
export function computeMutateScope(baseRef: string, repoRoot: string): string[] {
  const config = parseMutateConfig(loadMutateFromConfig(repoRoot));
  const changed = changedFilesSinceBase(baseRef, repoRoot);
  return scopeChangedFiles(changed, config);
}

/**
 * CLI: `tsx tools/stryker-diff-scope.ts <baseRef>` prints the newline-separated
 * scoped file list to stdout (empty output = nothing to mutate). The CI step
 * captures it and decides whether to invoke Stryker. Kept side-effect-free
 * except for the explicit stdout write so the module stays unit-testable.
 */
function main(): void {
  const baseRef = process.argv[2];
  if (!baseRef || baseRef.length === 0) {
    process.stderr.write("usage: stryker-diff-scope <baseRef>\n");
    process.exit(2);
  }
  const scope = computeMutateScope(baseRef, process.cwd());
  if (scope.length > 0) process.stdout.write(scope.join("\n") + "\n");
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && process.argv[1].endsWith("stryker-diff-scope.ts")) {
  main();
}
