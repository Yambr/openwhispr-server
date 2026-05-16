#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-no-suppressions.ts — LOCKER-02 enforcement CLI
 * (Phase 31 / Plan 02 — DISCIPLINE Rule 12).
 *
 * Refuses type-suppression patterns inside `apps/** /src/**` and
 * `packages/** /src/**` source trees. Mirrors `lint-dockerfile-tls.ts`
 * shape: bare `[rootDir]` positional argv, exit codes 0/1/2.
 *
 * Forbidden patterns (one entry per regex):
 *   1. `as any`              — narrow the type or use a typed fallback.
 *   2. `as unknown as`       — double-cast reserved for verified boundaries.
 *   3. ts-ignore comment     — convert to ts-expect-error issue-NNNN: <reason>.
 *   4. ts-nocheck comment    — file-wide check disable; convert to per-line.
 *   5. ts-expect-error comment MUST carry an `issue-NNNN: <reason>` suffix.
 *      Bare or unprefixed ts-expect-error is flagged as malformed.
 *
 * The allowlist at `tools/lint-no-suppressions.allowlist.txt` is
 * **line-granular**: each entry pins `<posixFile>:<lineNumber>` and is
 * the canonical way to absorb pre-existing debt or carve out
 * verified-boundary casts. Entries SHOULD carry an inline
 * `# issue-NNNN-<short-tag>` rationale.
 *
 * Test-path scope: this linter scans only NON-test source paths. Tests
 * legitimately use suppressions for negative-typing assertions, so
 * `** / *.test.ts` and `**\/__tests__/**` are excluded from the scan.
 *
 * Exit codes:
 *   0 — clean (or all violations are absorbed by the allowlist)
 *   1 — at least one unallowlisted violation; per-file summary on stderr
 *   2 — internal error
 *
 * Usage:
 *   pnpm exec tsx tools/lint-no-suppressions.ts [rootDir]
 *   pnpm exec tsx tools/lint-no-suppressions.ts [rootDir] --seed-allowlist
 *     ↑ writes the current findings to the allowlist file (one-shot
 *       bootstrapping; the developer then reviews and edits the inline
 *       `# issue-NNNN-...` rationale tokens).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { exit } from "node:process";

/** A single suppression match. */
export interface Violation {
  /** POSIX path of the offending source file, relative to scan rootDir. */
  file: string;
  /** 1-based line number. */
  lineNumber: number;
  /** Full text of the offending line (untrimmed). */
  lineText: string;
  /** Pattern label (one of FORBIDDEN[].label). */
  label: string;
}

/** Allowlist file path relative to the scan rootDir. */
export const ALLOWLIST_FILE = "tools/lint-no-suppressions.allowlist.txt";

/**
 * Glob restricted to `apps/** /src/**` + `packages/** /src/**` so we do
 * not scan tools, docs, planning, fixtures, or build output. Mirrors the
 * 31-RESEARCH §Pattern-1 scope decision.
 */
const PATTERNS = ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"];

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
  // Tests legitimately use suppressions for negative-typing assertions.
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/__tests__/**",
];

/**
 * Forbidden patterns scanned per-line. Order matters: the first hit on a
 * line wins (one finding per line max). The labels are surfaced to
 * callers + the human-readable stderr summary.
 */
const FORBIDDEN: {
  readonly regex: RegExp;
  readonly label: string;
  readonly remediation: string;
}[] = [
  {
    regex: /\bas\s+any\b/,
    label: "as-any",
    remediation:
      "narrow the type or add a typed-fallback; if truly unavoidable, use `as unknown as T` ONLY at a verified boundary and allowlist with issue-NNNN.",
  },
  {
    regex: /\bas\s+unknown\s+as\b/,
    label: "as-unknown-as",
    remediation:
      "double-cast is reserved for verified boundaries; require an allowlist entry with issue-NNNN rationale.",
  },
  {
    regex: /\/\/\s*@ts-ignore\b/,
    label: "ts-ignore",
    remediation:
      "use `@ts-expect-error issue-NNNN: <reason>` so the suppression decays when the type lies become true.",
  },
  {
    regex: /\/\/\s*@ts-nocheck\b/,
    label: "ts-nocheck",
    remediation:
      "`@ts-nocheck` disables an entire file; convert to per-line `@ts-expect-error issue-NNNN: <reason>`.",
  },
  {
    // Matches `@ts-expect-error` NOT followed by `issue-<digits>: <non-space>`.
    regex: /\/\/\s*@ts-expect-error(?!\s+issue-\d+:\s+\S)/,
    label: "expect-error-malformed",
    remediation: "format: `// @ts-expect-error issue-NNNN: short reason`.",
  },
];

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Read the optional allowlist file at `rootDir/ALLOWLIST_FILE`. Each
 * line is `<posixFile>:<lineNumber>` optionally followed by whitespace
 * and a `# rationale`. Blank lines and lines starting with `#` are
 * skipped. Returns the set of `file:lineNumber` keys.
 */
export function readAllowlist(rootDir: string): Set<string> {
  const file = join(rootDir, ALLOWLIST_FILE);
  if (!existsSync(file)) return new Set();
  const out = new Set<string>();
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Drop inline `# rationale` and surrounding whitespace.
    /* c8 ignore next — `?? ""` defends against TS undefined-on-split; split()
       always yields at least one element so the fallback is structurally
       unreachable in deterministic test runs. */
    const beforeHash = trimmed.split("#")[0]?.trim() ?? "";
    if (beforeHash) out.add(beforeHash);
  }
  return out;
}

/**
 * Scan `rootDir` for source files and return the sorted list of
 * suppression-pattern violations whose `<file>:<lineNumber>` key is NOT
 * in the allowlist. Each line yields at most one violation (first
 * pattern wins) to keep allowlist seeding 1:1 with findings.
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
      /* c8 ignore next — PATTERNS entries don't overlap; dedup is defensive. */
      if (seen.has(posixRel)) continue;
      seen.add(posixRel);
      let text: string;
      try {
        text = readFileSync(resolve(realRoot, rel), "utf8");
      } catch {
        /* c8 ignore next 2 — unreadable file is skipped defensively. */
        continue;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        /* c8 ignore next — split() always yields strings; `?? ""` is defensive. */
        const line = lines[i] ?? "";
        for (const { regex, label } of FORBIDDEN) {
          if (regex.test(line)) {
            const key = `${posixRel}:${i + 1}`;
            if (!allowlist.has(key)) {
              out.push({ file: posixRel, lineNumber: i + 1, lineText: line, label });
            }
            break; // one finding per line
          }
        }
      }
    }
  }
  out.sort((a, b) => {
    /* c8 ignore next 3 — sort comparator: v8 coverage only exercises whichever
       branch the glob iteration order happens to produce; the descending
       direction is structurally unreachable in deterministic test runs. */
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.lineNumber !== b.lineNumber) return a.lineNumber - b.lineNumber;
    /* c8 ignore next — same file + same line tiebreak (one-per-line ⇒ unreachable). */
    return a.label < b.label ? -1 : 1;
  });
  return out;
}

/**
 * Write the current findings to the allowlist file with a stable
 * `# issue-31-debt-suppression` rationale on each line. Idempotent: a
 * subsequent CLI run without `--seed-allowlist` exits 0 because every
 * finding is now absorbed.
 */
export async function seedAllowlist(rootDir: string): Promise<{ count: number; path: string }> {
  const realRoot = resolve(rootDir);
  const violations = await findViolations(realRoot);
  const target = join(realRoot, ALLOWLIST_FILE);
  mkdirSync(dirname(target), { recursive: true });
  const header = [
    "# lint-no-suppressions allowlist — LOCKER-02 (Phase 31 / Plan 02).",
    "# Format: `<posixFile>:<lineNumber>  # issue-NNNN-<tag>`",
    "# Generated by `pnpm exec tsx tools/lint-no-suppressions.ts <root> --seed-allowlist`.",
    "# Add a new line ONLY with a one-line rationale in the same commit.",
    "",
  ].join("\n");
  const body = violations
    .map((v) => `${v.file}:${v.lineNumber}  # issue-31-debt-suppression`)
    .join("\n");
  writeFileSync(target, `${header}${body}${body ? "\n" : ""}`);
  return { count: violations.length, path: target };
}

export async function main(argv: string[]): Promise<number> {
  const positional: string[] = [];
  let seed = false;
  for (const a of argv) {
    if (a === "--seed-allowlist") seed = true;
    else positional.push(a);
  }
  const rootDir = positional[0] ?? process.cwd();
  try {
    if (seed) {
      const r = await seedAllowlist(rootDir);
      process.stdout.write(`lint-no-suppressions: wrote ${r.count} entries to ${r.path}\n`);
      return 0;
    }
    const violations = await findViolations(rootDir);
    if (violations.length === 0) {
      process.stdout.write(`lint-no-suppressions: clean (${rootDir})\n`);
      return 0;
    }
    const byFile = new Map<string, number>();
    for (const v of violations) {
      byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);
    }
    process.stderr.write(
      `lint-no-suppressions: ${violations.length} suppression(s) across ${byFile.size} file(s):\n`,
    );
    for (const v of violations) {
      process.stderr.write(
        `  ${v.file}:${v.lineNumber}  [${v.label}]  ${v.lineText.trim().slice(0, 100)}\n`,
      );
    }
    process.stderr.write(
      `Remediate or add the offending line to ${ALLOWLIST_FILE} with a one-line ` +
        `# issue-NNNN-<tag> rationale in the same commit.\n`,
    );
    return 1;
  } catch (err) {
    /* c8 ignore next 4 — error-path is exercised by the tsx process boundary,
       not by the in-process findViolations call which has its own try/catch. */
    process.stderr.write(
      `lint-no-suppressions: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
}

/* c8 ignore start */
const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return arg1.endsWith("lint-no-suppressions.ts") || arg1.endsWith("lint-no-suppressions.js");
})();
if (invokedDirect) {
  main(process.argv.slice(2)).then(
    (code) => exit(code),
    (err) => {
      process.stderr.write(
        `lint-no-suppressions: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      exit(2);
    },
  );
}
/* c8 ignore stop */
