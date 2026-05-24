#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-no-dockerhub-pg-image.ts — regression guard preventing accidental
 * reintroduction of the unpublished Docker Hub image reference
 * `openwhispr/postgres:<tag>` in source code, compose overlays, tests,
 * and operator docs.
 *
 * Background: prior to 2026-05-24, every testcontainer-using integration
 * test referenced `openwhispr/postgres:17.5-pgpartman` — an image that
 * was only ever built locally and never published to any registry. CI
 * failed with `pull access denied for openwhispr/postgres` because the
 * Docker daemon resolves bare names against Docker Hub. The fix swapped
 * every reference to the GHCR-published variant
 * `ghcr.io/yambr/openwhispr-postgres-17-pgpartman:<tag>` and added this
 * lint to make the change irreversible.
 *
 * Allowlist: `tools/lint-no-dockerhub-pg-image.allowlist.txt` (one POSIX
 * path per line). Entries are appropriate for:
 *   - the original Dockerfile comment that documents the source build
 *   - planning archives describing the historical pattern
 *   - this lint script + test (they MUST mention the forbidden token)
 *
 * Exit codes:
 *   0 — no violations
 *   1 — at least one violation; per-file summary printed to stderr
 *   2 — internal error
 *
 * Usage:
 *   pnpm exec tsx tools/lint-no-dockerhub-pg-image.ts [rootDir]
 */
import { existsSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { exit } from "node:process";

/** A single forbidden-token match. */
export interface Violation {
  file: string;
  lineNumber: number;
  lineText: string;
}

export const ALLOWLIST_FILE = "tools/lint-no-dockerhub-pg-image.allowlist.txt";

/**
 * Globs scanned. We deliberately scan source-of-truth file types only —
 * never `node_modules`, build outputs, or coverage/report folders.
 */
const PATTERNS = [
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.mjs",
  "**/*.cjs",
  "**/*.yml",
  "**/*.yaml",
  "**/*.md",
  "**/Dockerfile",
  "**/Dockerfile.*",
  "**/*.sh",
];

const IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.stryker-tmp/**",
  "**/reports/**",
  "**/build/**",
  "**/__generated__/**",
  "**/.git/**",
  // tools' own unit-test fixtures may reference the forbidden token by design.
  "**/__tests__/fixtures/**",
  // historical planning archives describing the bad-pattern WHY they
  // mention it; full path-level allowlist is in allowlist.txt for fine
  // granularity, but exclude the archive root wholesale to keep the scan
  // cheap.
  ".planning/backlog-archive/**",
  ".planning/debug/resolved/**",
];

/**
 * Forbidden regex. Matches `openwhispr/postgres:<anything>` as a bare
 * Docker Hub-style reference. We do NOT match `ghcr.io/<owner>/openwhispr-postgres-*`
 * — the GHCR path uses a hyphen, not a slash, and a different registry
 * prefix.
 */
export const FORBIDDEN = /\bopenwhispr\/postgres:[A-Za-z0-9._-]+/;

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

export function readAllowlist(rootDir: string): Set<string> {
  const file = join(rootDir, ALLOWLIST_FILE);
  if (!existsSync(file)) return new Set();
  const out = new Set<string>();
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    out.add(line);
  }
  return out;
}

export async function findViolations(rootDir: string): Promise<Violation[]> {
  const realRoot = resolve(rootDir);
  const allowlist = readAllowlist(realRoot);
  const seen = new Set<string>();
  const out: Violation[] = [];
  for (const pattern of PATTERNS) {
    for await (const f of glob(pattern, { cwd: realRoot, exclude: IGNORE })) {
      const rel = typeof f === "string" ? f : String(f);
      const posixRel = toPosix(rel);
      if (seen.has(posixRel)) continue;
      seen.add(posixRel);
      if (allowlist.has(posixRel)) continue;
      let text: string;
      try {
        text = readFileSync(resolve(realRoot, rel), "utf8");
      } catch {
        continue;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        if (FORBIDDEN.test(line)) {
          out.push({ file: posixRel, lineNumber: i + 1, lineText: line });
        }
      }
    }
  }
  out.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.lineNumber - b.lineNumber;
  });
  return out;
}

export async function main(argv: string[]): Promise<number> {
  const rootDir = argv[0] ?? process.cwd();
  let violations: Violation[];
  try {
    violations = await findViolations(rootDir);
  } catch (err) {
    process.stderr.write(
      `lint-no-dockerhub-pg-image: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
  if (violations.length === 0) {
    process.stdout.write(`lint-no-dockerhub-pg-image: clean (${rootDir})\n`);
    return 0;
  }
  const byFile = new Map<string, number>();
  for (const v of violations) {
    byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);
  }
  process.stderr.write(
    `lint-no-dockerhub-pg-image: ${violations.length} unpublished-image reference(s) across ${byFile.size} file(s):\n`,
  );
  for (const [file, count] of [...byFile.entries()].sort()) {
    process.stderr.write(`  ${file}: ${count}\n`);
  }
  process.stderr.write(
    "Replace `openwhispr/postgres:<tag>` with the GHCR-published path " +
      "`ghcr.io/yambr/openwhispr-postgres-17-pgpartman:<tag>`, or add the " +
      `file to ${ALLOWLIST_FILE} with a one-line rationale in the commit body.\n`,
  );
  return 1;
}

/* c8 ignore start */
const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return (
    arg1.endsWith("lint-no-dockerhub-pg-image.ts") || arg1.endsWith("lint-no-dockerhub-pg-image.js")
  );
})();
if (invokedDirect) {
  main(process.argv.slice(2)).then(
    (code) => exit(code),
    (err) => {
      process.stderr.write(
        `lint-no-dockerhub-pg-image: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      exit(2);
    },
  );
}
/* c8 ignore stop */
