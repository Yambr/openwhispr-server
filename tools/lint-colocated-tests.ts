#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-colocated-tests.ts — Test-layout regression guard (STRUCT-01).
 *
 * Forbids future co-located `*.test.ts` siblings of source files under
 * apps/<app>/src/** and packages/<pkg>/src/**. Canonical layout (per
 * docs/conventions.md "Test layout") places unit tests under
 * apps/<app>/tests/unit/** and packages/<pkg>/tests/unit/**.
 *
 * Allow-list (paths exempt from the rule):
 *   tools/load-test/**                     (dev tooling, not an app/library)
 *   tests/**                               (root e2e / conformance / infra)
 *   apps/<app>/tests/**                    (canonical app layout)
 *   packages/<pkg>/tests/**                (canonical package layout)
 *   tools/test-probe/tests/**              (canonical tooling test layout)
 *
 * Task 0 pivot rationale: the repo has NO ESLint config (.eslintrc* and
 * eslint.config.* both absent); lint stack is Biome (`pnpm lint` =
 * `biome check .`). Authoring an ESLint plugin would require introducing
 * the ESLint runtime AND `@typescript-eslint/utils` AND a config file.
 * Mirroring the existing tools/lint-tdd.ts pattern keeps the rule in the
 * `pnpm lint:colocated-tests` script chain alongside lint:tdd / lint:rls /
 * lint:english, with zero new runtime dependencies.
 *
 * Exit codes:
 *   0 — no violations
 *   1 — at least one violation; details printed to stderr
 *   2 — internal error
 *
 * Usage:
 *   pnpm exec tsx tools/lint-colocated-tests.ts [rootDir]
 */
import { existsSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { exit } from "node:process";

/**
 * Path (relative to rootDir) of the optional legacy allow-list file.
 * One POSIX path per line; lines starting with `#` or blank are ignored.
 * The file is committed during Phase 15-01 and DELETED by 15-02 as the
 * final commit of that plan, once migrate-tests.ts --apply has relocated
 * every co-located test to apps|packages/<ws>/tests/unit/**.
 */
export const LEGACY_ALLOWLIST_FILE = "tools/lint-colocated-tests.legacy-allowlist.txt";

export const ALLOWED_PREFIXES = ["tools/load-test/", "tools/test-probe/tests/", "tests/"];

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * True when `rel` is exempt from the no-colocated-tests rule.
 *
 * The allow-list matches:
 *   1. Top-level exempt prefixes (tools/load-test/, tests/, …)
 *   2. apps/<app>/tests/** (canonical app test layout)
 *   3. packages/<pkg>/tests/** (canonical package test layout)
 */
export function isAllowed(rel: string): boolean {
  const norm = toPosix(rel);
  for (const prefix of ALLOWED_PREFIXES) {
    if (norm === prefix.replace(/\/$/, "") || norm.startsWith(prefix)) return true;
  }
  // Canonical workspace tests dirs.
  if (/^(apps|packages)\/[^/]+\/tests\//.test(norm)) return true;
  return false;
}

/**
 * Read the optional legacy allow-list file at `rootDir/LEGACY_ALLOWLIST_FILE`.
 * Returns an empty Set when the file does not exist (canonical post-15-02 state).
 */
export function readLegacyAllowlist(rootDir: string): Set<string> {
  const file = join(rootDir, LEGACY_ALLOWLIST_FILE);
  if (!existsSync(file)) return new Set();
  const out = new Set<string>();
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    out.add(line);
  }
  return out;
}

/**
 * Scan `rootDir` for `*.test.ts` files under apps/<app>/src/** and
 * packages/<pkg>/src/**; return the sorted, deduplicated list of paths
 * that violate the canonical layout. Paths listed in the legacy
 * allow-list (Phase 15-01 -> 15-02 transition only) are skipped.
 */
export async function findViolations(rootDir: string): Promise<string[]> {
  const realRoot = resolve(rootDir);
  const legacy = readLegacyAllowlist(realRoot);
  const patterns = ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"];
  const out = new Set<string>();
  for (const pat of patterns) {
    for await (const f of glob(pat, {
      cwd: realRoot,
      exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    })) {
      /* c8 ignore next — node:fs/promises glob yields strings in this configuration. */
      const rel = typeof f === "string" ? f : String(f);
      const posixRel = toPosix(rel);
      // Defensive: the glob shape apps|packages/<workspace>/src/... never
      // matches an allow-listed path, so this branch is unreachable in
      // practice. Kept as belt-and-braces should the glob be widened.
      /* c8 ignore next */
      if (isAllowed(posixRel)) continue;
      if (legacy.has(posixRel)) continue;
      out.add(posixRel);
    }
  }
  return [...out].sort();
}

/* c8 ignore start */
export async function main(argv: string[]): Promise<number> {
  const rootDir = argv[2] ?? process.cwd();
  let violations: string[];
  try {
    violations = await findViolations(rootDir);
  } catch (err) {
    process.stderr.write(
      `lint-colocated-tests: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
  if (violations.length === 0) {
    process.stdout.write(`lint-colocated-tests: clean (${rootDir})\n`);
    return 0;
  }
  process.stderr.write(
    `lint-colocated-tests: ${violations.length} co-located test file(s) found:\n`,
  );
  for (const v of violations) process.stderr.write(`  ${v}\n`);
  process.stderr.write(
    'Move under apps/<app>/tests/unit/ or packages/<pkg>/tests/unit/ (see docs/conventions.md "Test layout").\n',
  );
  return 1;
}

const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return arg1.endsWith("lint-colocated-tests.ts") || arg1.endsWith("lint-colocated-tests.js");
})();
if (invokedDirect) {
  main(process.argv).then(
    (code) => exit(code),
    (err) => {
      process.stderr.write(
        `lint-colocated-tests: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      exit(2);
    },
  );
}
/* c8 ignore stop */
