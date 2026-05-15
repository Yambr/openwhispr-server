#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-phase-tag-comments.ts — Regression-guard CLI (Phase 16 / Plan 01).
 *
 * Scans `{apps,packages}/**` for `.ts` + `.tsx` files and reports any line
 * classified as REMOVE by the shared `classifyLine` predicate
 * (`tools/phase-tag-sweep.ts`). Mirrors `tools/lint-colocated-tests.ts`
 * shape: bare `[rootDir]` positional argv, exit codes 0/1/2.
 *
 * Allowlist: `tools/lint-phase-tag-comments.allowlist.txt` holds POSIX
 * paths whose REMOVE-bucket comments are intentionally retained. The file
 * is transitional — entries should be removed as sweep commits land.
 *
 * Exit codes:
 *   0 — no violations
 *   1 — at least one violation; details printed to stderr
 *   2 — internal error
 *
 * Usage:
 *   pnpm exec tsx tools/lint-phase-tag-comments.ts [rootDir]
 */
import { existsSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { exit } from "node:process";

import { classifyLine, type Violation } from "./phase-tag-sweep.js";

/**
 * Path (relative to rootDir) of the transitional allowlist file. One
 * POSIX path per line; lines starting with `#` or blank are ignored.
 * Entries SHOULD be removed when their corresponding sweep commit lands;
 * new entries require a one-line rationale in the commit body.
 */
export const ALLOWLIST_FILE = "tools/lint-phase-tag-comments.allowlist.txt";

const PATTERNS = ["apps/**/*.ts", "apps/**/*.tsx", "packages/**/*.ts", "packages/**/*.tsx"];

const IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.stryker-tmp/**",
  "**/reports/**",
  "**/build/**",
  "**/__generated__/**",
  "**/*.generated.*",
  "**/locales/**",
  "**/.git/**",
];

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Read the optional allowlist file at `rootDir/ALLOWLIST_FILE`. Returns
 * an empty Set when the file does not exist. Lines beginning with `#`
 * (after trimming) and blank lines are skipped; remaining lines are
 * trimmed and returned as POSIX paths.
 */
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

/**
 * Scan `rootDir` for `.ts`/`.tsx` files under `apps/` + `packages/` and
 * return the sorted list of REMOVE-classified line violations whose
 * POSIX path is NOT in the allowlist.
 */
export async function findViolations(rootDir: string): Promise<Violation[]> {
  const realRoot = resolve(rootDir);
  const allowlist = readAllowlist(realRoot);
  const seen = new Set<string>();
  const out: Violation[] = [];
  for (const pattern of PATTERNS) {
    for await (const f of glob(pattern, { cwd: realRoot, exclude: IGNORE })) {
      /* c8 ignore next — node:fs/promises glob yields strings in this configuration. */
      const rel = typeof f === "string" ? f : String(f);
      const posixRel = toPosix(rel);
      if (seen.has(posixRel)) continue;
      seen.add(posixRel);
      if (allowlist.has(posixRel)) continue;
      let text: string;
      try {
        text = readFileSync(resolve(realRoot, rel), "utf8");
      } catch {
        /* c8 ignore next 2 */
        continue;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        const verdict = classifyLine(line, {
          prev: i > 0 ? lines[i - 1] : undefined,
          next: i + 1 < lines.length ? lines[i + 1] : undefined,
        });
        if (verdict === "REMOVE") {
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
    /* c8 ignore next 5 */
    process.stderr.write(
      `lint-phase-tag-comments: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
  if (violations.length === 0) {
    process.stdout.write(`lint-phase-tag-comments: clean (${rootDir})\n`);
    return 0;
  }
  const byFile = new Map<string, number>();
  for (const v of violations) {
    byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);
  }
  process.stderr.write(
    `lint-phase-tag-comments: ${violations.length} REMOVE-bucket comment(s) across ${byFile.size} file(s):\n`,
  );
  for (const [file, count] of [...byFile.entries()].sort()) {
    process.stderr.write(`  ${file}: ${count}\n`);
  }
  process.stderr.write(
    "Run `pnpm exec tsx tools/phase-tag-sweep.ts fix` to remove, or add the path to " +
      `${ALLOWLIST_FILE} with a one-line rationale.\n`,
  );
  return 1;
}

/* c8 ignore start */
const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return arg1.endsWith("lint-phase-tag-comments.ts") || arg1.endsWith("lint-phase-tag-comments.js");
})();
if (invokedDirect) {
  main(process.argv.slice(2)).then(
    (code) => exit(code),
    (err) => {
      process.stderr.write(
        `lint-phase-tag-comments: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      exit(2);
    },
  );
}
/* c8 ignore stop */
