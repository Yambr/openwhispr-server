#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-no-env-branches.ts — NODE_ENV branching regression-guard CLI
 * (Phase 31 / Plan 01 — LOCKER-01).
 *
 * Scans `apps/x/src/x` and `packages/x/src/x` TypeScript sources (`.ts`,
 * `.tsx`) for two forbidden patterns:
 *
 *   1. `process.env.NODE_ENV` reads anywhere outside the boundary files.
 *   2. `NODE_ENV ===` or `NODE_ENV !==` comparisons (with or without the
 *      `process.env.` prefix), which encode runtime-mode branching in
 *      production code paths.
 *
 * Boundary files exempt by IGNORE: `bootstrap.ts`, `config/x.ts`,
 * `otel-bootstrap.ts`, `x.config.ts` (canonical places where NODE_ENV may
 * be read once and the resolved mode injected through DI). Test paths
 * (`x.test.ts`, `__tests__`, `__test`) are excluded by the same IGNORE.
 *
 * Allowlist: per-line entries `<posix-file>:<line>` in
 * `tools/lint-no-env-branches.allowlist.txt` suppress documented legacy
 * violations. Each entry should be seeded with a trailing `# issue-NNNN`
 * tracking token. Lines beginning with `#` (after trim) and blank lines
 * are skipped; trailing `# rationale` after the file:line key is also
 * stripped on read.
 *
 * Exit codes:
 *   0 — no violations (or all violations allowlisted)
 *   1 — at least one unallowlisted violation; stderr enumerates each as
 *       `file:line  label  remediation`
 *   2 — internal error during scan
 *
 * Usage:
 *   pnpm exec tsx tools/lint-no-env-branches.ts [rootDir]
 */
import { existsSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { exit } from "node:process";

/** A single forbidden-pattern match on a line of a source file. */
export interface Violation {
  /** POSIX path of the offending file, relative to scan rootDir. */
  file: string;
  /** 1-based line number. */
  lineNumber: number;
  /** The full text of the offending line (untrimmed). */
  lineText: string;
  /** Category label (`NODE_ENV-read` or `NODE_ENV-compare`). */
  label: string;
  /** Remediation hint surfaced to stderr. */
  remediation: string;
}

/**
 * Path (relative to rootDir) of the per-line allowlist file. One entry
 * per line in `<posix-path>:<lineNumber>` format. Lines starting with `#`
 * (after trim) and blank lines are ignored. Anything after a `#` on a
 * value line is treated as inline rationale and stripped.
 */
export const ALLOWLIST_FILE = "tools/lint-no-env-branches.allowlist.txt";

/** Glob roots: TypeScript sources under apps/x/src and packages/x/src. */
const PATTERNS = [
  "apps/*/src/**/*.ts",
  "apps/*/src/**/*.tsx",
  "packages/*/src/**/*.ts",
  "packages/*/src/**/*.tsx",
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
  "**/__tests__/**",
  "**/__test/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/bootstrap.ts",
  "**/config/*.ts",
  "**/otel-bootstrap.ts",
  "**/*.config.ts",
];

/**
 * Forbidden patterns scanned per-line. The two regexes mirror Phase 31
 * 31-RESEARCH §LOCKER-01 canonical pattern and capture both the
 * `process.env.NODE_ENV` read (with or without comparison) and the
 * comparison form (with or without the `process.env.` prefix; covers
 * `env.NODE_ENV ===` destructured aliases too).
 */
const FORBIDDEN: {
  readonly regex: RegExp;
  readonly label: string;
  readonly remediation: string;
}[] = [
  {
    regex: /\bprocess\.env\.NODE_ENV\b/,
    label: "NODE_ENV-read",
    remediation:
      "read NODE_ENV only in bootstrap.ts / config/*.ts / otel-bootstrap.ts; inject via DI",
  },
  {
    regex: /\bNODE_ENV\s*[!=]==/,
    label: "NODE_ENV-compare",
    remediation: "compare NODE_ENV only at the boundary; thread the resolved mode through opts",
  },
];

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Read the optional allowlist file at `rootDir/ALLOWLIST_FILE`. Returns
 * an empty Set when the file does not exist. Lines beginning with `#`
 * (after trim) and blank lines are skipped. For remaining lines, any
 * inline trailing `# rationale` is stripped, then the trimmed
 * `<posix-path>:<line>` key is added to the Set.
 */
export function readAllowlist(rootDir: string): Set<string> {
  const file = join(rootDir, ALLOWLIST_FILE);
  if (!existsSync(file)) return new Set();
  const out = new Set<string>();
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Strip inline trailing rationale comment.
    const hashIdx = trimmed.indexOf("#");
    const key = (hashIdx === -1 ? trimmed : trimmed.slice(0, hashIdx)).trim();
    /* c8 ignore next — defensive guard: a `#`-prefixed-only line is caught
       by the earlier `startsWith('#')` check, so this branch is structurally
       unreachable in practice. */
    if (key.length === 0) continue;
    out.add(key);
  }
  return out;
}

/**
 * Scan `rootDir` for source files under `apps/x/src/x` and
 * `packages/x/src/x`. Returns the sorted list of forbidden-pattern
 * violations whose `<posix-path>:<line>` key is NOT in the allowlist.
 * Each line may produce multiple violations (one per matched label).
 */
export async function findViolations(rootDir: string): Promise<Violation[]> {
  const realRoot = resolve(rootDir);
  const allowlist = readAllowlist(realRoot);
  const seen = new Set<string>();
  const out: Violation[] = [];
  for (const pattern of PATTERNS) {
    for await (const f of glob(pattern, { cwd: realRoot, exclude: IGNORE })) {
      /* c8 ignore next — node:fs/promises glob yields strings here. */
      const rel = typeof f === "string" ? f : String(f);
      const posixRel = toPosix(rel);
      /* c8 ignore next — PATTERNS entries are disjoint by extension/root
         glob; same posix path cannot appear twice. Dedup is defensive. */
      if (seen.has(posixRel)) continue;
      seen.add(posixRel);
      let text: string;
      try {
        text = readFileSync(resolve(realRoot, rel), "utf8");
      } catch {
        /* c8 ignore next 2 — file vanished between glob and read. */
        continue;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        /* c8 ignore next — split() yields strings; `?? ""` is defensive. */
        const line = lines[i] ?? "";
        const key = `${posixRel}:${i + 1}`;
        if (allowlist.has(key)) continue;
        for (const { regex, label, remediation } of FORBIDDEN) {
          if (regex.test(line)) {
            out.push({
              file: posixRel,
              lineNumber: i + 1,
              lineText: line,
              label,
              remediation,
            });
          }
        }
      }
    }
  }
  out.sort((a, b) => {
    /* c8 ignore next 3 — sort comparator: v8 coverage only exercises whichever
       direction the glob iteration order happens to produce; one branch is
       structurally unreachable in deterministic test runs. */
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.lineNumber !== b.lineNumber) return a.lineNumber - b.lineNumber;
    /* c8 ignore next — same file + same line → label-order tiebreak. */
    return a.label < b.label ? -1 : 1;
  });
  return out;
}

export async function main(argv: string[]): Promise<number> {
  const rootDir = argv[0] ?? process.cwd();
  let violations: Violation[];
  try {
    violations = await findViolations(rootDir);
  } catch (err) {
    /* c8 ignore next — `String(err)` branch only for non-Error throws;
       the test path uses a real EISDIR which is always an Error. */
    process.stderr.write(
      `lint-no-env-branches: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
  if (violations.length === 0) {
    process.stdout.write(`lint-no-env-branches: clean (${rootDir})\n`);
    return 0;
  }
  process.stderr.write(
    `lint-no-env-branches: ${violations.length} NODE_ENV branch(es) in ${rootDir}:\n`,
  );
  for (const v of violations) {
    process.stderr.write(`  ${v.file}:${v.lineNumber}  ${v.label}  ${v.remediation}\n`);
  }
  process.stderr.write(
    `Inject the resolved mode through DI, or add the file:line key to ${ALLOWLIST_FILE} with a one-line rationale (e.g. \`# issue-NNNN\`) in the commit body.\n`,
  );
  return 1;
}

/* c8 ignore start */
const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return arg1.endsWith("lint-no-env-branches.ts") || arg1.endsWith("lint-no-env-branches.js");
})();
if (invokedDirect) {
  main(process.argv.slice(2)).then(
    (code) => exit(code),
    (err) => {
      process.stderr.write(
        `lint-no-env-branches: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      exit(2);
    },
  );
}
/* c8 ignore stop */
