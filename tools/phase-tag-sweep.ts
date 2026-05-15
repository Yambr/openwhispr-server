#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * phase-tag-sweep.ts — Heuristic phase-tag comment codemod (Phase 16 / Plan 01).
 *
 * Scans `.ts`/`.tsx` files under `apps/` + `packages/` and classifies each
 * line into a REMOVE or KEEP bucket per CONTEXT Q2 (heuristic-only,
 * conservative-KEEP defaults). The classifier is a SINGLE predicate
 * (`classifyLine`) imported by both this codemod AND the regression-guard
 * lint CLI (`tools/lint-phase-tag-comments.ts`) so allowlist drift is
 * structurally impossible.
 *
 * Approach: regex-on-text line-by-line, NOT AST traversal. ts-morph stays
 * unused-by-Phase-16 (reserved for a deferred inline-comment phase).
 *
 * Exit codes (CLI):
 *   audit:
 *     0 — every in-scope file is clean
 *     1 — at least one REMOVE-bucket comment was found (count printed to stderr)
 *   fix:
 *     0 — codemod completed (count of removed comments printed to stdout)
 *   unknown verb / internal error → 2
 *
 * Usage:
 *   pnpm exec tsx tools/phase-tag-sweep.ts audit [rootDir]
 *   pnpm exec tsx tools/phase-tag-sweep.ts fix   [rootDir]
 *
 * Idempotent: running `fix` twice in succession leaves the working tree
 * byte-identical.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { resolve } from "node:path";
import { exit } from "node:process";

const EXTENSIONS = [".ts", ".tsx"];

const INCLUDE_ROOTS = ["apps", "packages"];

const SKIP_DIRS = [
  "node_modules",
  "dist",
  "coverage",
  ".next",
  ".stryker-tmp",
  "reports",
  "build",
  "__generated__",
];

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

export interface Violation {
  /** POSIX-normalized path relative to rootDir. */
  file: string;
  /** 1-based line number. */
  lineNumber: number;
  /** Raw line text (unchanged from source). */
  lineText: string;
}

export interface Neighbours {
  prev?: string;
  next?: string;
}

// CONTEXT Q2 REMOVE rules — regex patterns. Each MUST match the entire
// line after trimming surrounding whitespace.
const REMOVE_RULE_1_HEADER =
  /^\s*\/\/\s*Phase\s+\d+(?:\.\d+)*(\s*[/-]\s*Plan\s+\d+(?:-\d+)?)?[:\s\-—]*$/;
// Extension of rule 1 — header form `// Phase NN[.M] [/ Plan NN-MM] [— body]`
// where the post-em-dash body, if present, has no KEEP-keyword and no
// KEEP-marker (those checks run BEFORE the REMOVE rules so they preempt
// this match). Captures the dominant real-world pattern that CONTEXT Q1
// scoped (754 header-style banners). Tightened to lines that DO start with
// `// Phase NN` so non-header `//` lines can't be swept by accident.
const REMOVE_RULE_1_HEADER_WITH_BODY =
  /^\s*\/\/\s*Phase\s+\d+(?:\.\d+)*(\s*[/-]\s*Plan\s+\d+(?:-\d+)?)?(\s*[/-]\s*Task\s+\d+(?:-\d+)?)?(\s*\([^)]*\))?(\s*[/-]\s*D-[\w.-]+)?\s*[—–-]\s*.+$/;
// Matches a comment-only line `  // D-19` with no body text after the ID.
// Trailing `// D-NN` on a code line is NOT matched — filtering whole lines
// would erase production code, which violates the "default-KEEP on
// ambiguity" precedence (CONTEXT Q2 KEEP rule 5). The regex anchors at the
// start of the line with optional leading whitespace.
const REMOVE_RULE_2_TRAILING_D = /^\s*\/\/\s*D-\d+(?:\.\d+(?:-EX\d+)?)?\s*$/;
const REMOVE_RULE_3_CLOSEOUT = /^\s*\/\/\s*D-\d+\.\d+-EX\d+\s+close-out:/;
const REMOVE_RULE_4_IMPL_NOTE = /^\s*\/\/\s*Phase\s+\d+\s+—\s+implementation note\s*$/;

// CONTEXT Q2 KEEP keyword set — case-sensitive on the uppercase tokens
// (NEVER, MUST), case-sensitive substring match on the lowercase ones.
const KEEP_KEYWORDS = ["because", "to avoid", "workaround", "fixes", "NEVER", "MUST", "prevent"];

// CONTEXT Q2 KEEP reference markers — non-trivial domain anchors.
const KEEP_MARKERS = ["PITFALLS §", "SUMMARY.md"];

function containsKeepKeyword(line: string): boolean {
  for (const kw of KEEP_KEYWORDS) {
    if (line.includes(kw)) return true;
  }
  return false;
}

function containsKeepMarker(line: string): boolean {
  for (const m of KEEP_MARKERS) {
    if (line.includes(m)) return true;
  }
  return false;
}

function hasInlineDashBody(line: string): boolean {
  // Inline `// D-NN — <body>` with non-empty body text after the em-dash.
  // Body must contain at least one non-whitespace character beyond the
  // em-dash (which itself is included in the line).
  const m = line.match(/\/\/\s*D-\d+(?:\.\d+(?:-EX\d+)?)?\s*—\s*(.+)$/);
  if (!m) return false;
  return (m[1] ?? "").trim().length > 0;
}

/**
 * Classify a single line as REMOVE or KEEP per CONTEXT Q2.
 *
 * KEEP rules are evaluated BEFORE REMOVE rules so the default-KEEP
 * precedence is structural rather than order-dependent on REMOVE matches.
 * Default branch returns KEEP — the codemod never auto-removes on ambiguity.
 */
export function classifyLine(line: string, neighbours: Neighbours): "REMOVE" | "KEEP" {
  // KEEP rule 2: keyword set.
  if (containsKeepKeyword(line)) return "KEEP";
  // KEEP rule 3: reference markers.
  if (containsKeepMarker(line)) return "KEEP";
  // KEEP rule 4: inline `// D-NN — <body>` with prose after em-dash.
  if (hasInlineDashBody(line)) return "KEEP";
  // KEEP rule 1: multi-line `//` context (prev or next is also `//`).
  const isCommentLine = /^\s*\/\//.test(line);
  if (isCommentLine) {
    const prevIsComment = neighbours.prev !== undefined && /^\s*\/\//.test(neighbours.prev);
    const nextIsComment = neighbours.next !== undefined && /^\s*\/\//.test(neighbours.next);
    if (prevIsComment || nextIsComment) return "KEEP";
  }
  // REMOVE rules — apply in fixed order (mutually disjoint in practice).
  if (REMOVE_RULE_3_CLOSEOUT.test(line)) return "REMOVE";
  if (REMOVE_RULE_4_IMPL_NOTE.test(line)) return "REMOVE";
  if (REMOVE_RULE_1_HEADER.test(line)) return "REMOVE";
  if (REMOVE_RULE_1_HEADER_WITH_BODY.test(line)) return "REMOVE";
  if (REMOVE_RULE_2_TRAILING_D.test(line)) return "REMOVE";
  // Default → KEEP (ambiguous → never auto-REMOVE).
  return "KEEP";
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function shouldSkip(relPath: string): boolean {
  const norm = toPosix(relPath);
  /* c8 ignore next 2 — defensive; glob patterns already exclude these. */
  if (/\.generated\.[a-z]+$/i.test(norm)) return true;
  for (const dir of SKIP_DIRS) {
    /* c8 ignore next */
    if (norm.includes(`/${dir}/`) || norm.startsWith(`${dir}/`)) return true;
  }
  const dot = norm.lastIndexOf(".");
  /* c8 ignore next */
  if (dot === -1) return true;
  const ext = norm.slice(dot);
  /* c8 ignore next */
  if (!EXTENSIONS.includes(ext)) return true;
  // INCLUDE_ROOTS gate — only `apps/` and `packages/` are in scope.
  let rooted = false;
  for (const r of INCLUDE_ROOTS) {
    if (norm.startsWith(`${r}/`)) {
      rooted = true;
      break;
    }
  }
  if (!rooted) return true;
  return false;
}

async function* iterateFiles(rootDir: string): AsyncGenerator<string> {
  const realRoot = resolve(rootDir);
  const seen = new Set<string>();
  for (const pattern of PATTERNS) {
    for await (const file of glob(pattern, { cwd: realRoot, exclude: IGNORE })) {
      /* c8 ignore next — node:fs/promises glob yields strings in this configuration. */
      const rel = typeof file === "string" ? file : String(file);
      const posixRel = toPosix(rel);
      if (seen.has(posixRel)) continue;
      seen.add(posixRel);
      if (shouldSkip(posixRel)) continue;
      yield posixRel;
    }
  }
}

function* classifyFile(text: string): Generator<{ lineNumber: number; lineText: string }> {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const verdict = classifyLine(line, {
      prev: i > 0 ? lines[i - 1] : undefined,
      next: i + 1 < lines.length ? lines[i + 1] : undefined,
    });
    if (verdict === "REMOVE") {
      yield { lineNumber: i + 1, lineText: line };
    }
  }
}

export async function auditDir(rootDir: string): Promise<Violation[]> {
  const realRoot = resolve(rootDir);
  const out: Violation[] = [];
  for await (const rel of iterateFiles(realRoot)) {
    const full = resolve(realRoot, rel);
    let text: string;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      /* c8 ignore next 2 */
      continue;
    }
    for (const v of classifyFile(text)) {
      out.push({ file: rel, lineNumber: v.lineNumber, lineText: v.lineText });
    }
  }
  return out;
}

export async function fixDir(
  rootDir: string,
): Promise<{ filesChanged: number; commentsRemoved: number }> {
  const realRoot = resolve(rootDir);
  let filesChanged = 0;
  let commentsRemoved = 0;
  for await (const rel of iterateFiles(realRoot)) {
    const full = resolve(realRoot, rel);
    let text: string;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      /* c8 ignore next 2 */
      continue;
    }
    const lines = text.split("\n");
    const keep: string[] = [];
    let removedInFile = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      const verdict = classifyLine(line, {
        prev: i > 0 ? lines[i - 1] : undefined,
        next: i + 1 < lines.length ? lines[i + 1] : undefined,
      });
      if (verdict === "REMOVE") {
        removedInFile += 1;
        continue;
      }
      keep.push(line);
    }
    if (removedInFile === 0) continue;
    const after = keep.join("\n");
    writeFileSync(full, after, "utf8");
    filesChanged += 1;
    commentsRemoved += removedInFile;
  }
  return { filesChanged, commentsRemoved };
}

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  const rootDir = argv[1] ?? process.cwd();
  if (cmd === "audit") {
    const violations = await auditDir(rootDir);
    if (violations.length === 0) {
      process.stdout.write(`phase-tag-sweep: audit clean (${rootDir})\n`);
      return 0;
    }
    const byFile = new Map<string, number>();
    for (const v of violations) {
      byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);
    }
    process.stderr.write(
      `phase-tag-sweep: ${violations.length} REMOVE-bucket comment(s) across ${byFile.size} file(s) in ${rootDir}\n`,
    );
    for (const [file, count] of [...byFile.entries()].sort()) {
      process.stderr.write(`  ${file}: ${count}\n`);
    }
    return 1;
  }
  if (cmd === "fix") {
    const { filesChanged, commentsRemoved } = await fixDir(rootDir);
    process.stdout.write(
      `phase-tag-sweep: ${commentsRemoved} comment(s) removed across ${filesChanged} file(s) under ${rootDir}\n`,
    );
    return 0;
  }
  process.stderr.write("usage: phase-tag-sweep.ts <audit|fix> [rootDir]\n");
  return 2;
}

/* c8 ignore start */
const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return arg1.endsWith("phase-tag-sweep.ts") || arg1.endsWith("phase-tag-sweep.js");
})();
if (invokedDirect) {
  main(process.argv.slice(2)).then(
    (code) => exit(code),
    (err) => {
      process.stderr.write(
        `phase-tag-sweep: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      exit(2);
    },
  );
}
/* c8 ignore stop */
