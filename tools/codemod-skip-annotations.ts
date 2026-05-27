#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * codemod-skip-annotations.ts — Quick 260527-pj6.
 *
 * One-shot migration helper that inserts a placeholder
 *   `// SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required`
 * line immediately above every `.skip` / `.todo` / `xit` / `xdescribe`
 * call site that does NOT already have a SKIP-REASON in the 5-line
 * lookback window (`tools/lint-skip-annotations.ts`).
 *
 * The codemod is invoked exactly ONCE at gate landing time. It is
 * deliberately NOT wired into `package.json` scripts as a direct
 * invocation to discourage accidental re-runs. The `test:codemod-
 * skip-annotations` script runs the TEST, not the codemod itself.
 *
 * Each insertion is recorded in
 * `.planning/quick/260527-pj6-pre-push-test-evidence-gate/
 * SKIP-AUDIT-BACKLOG.md` so the orphaned placeholder reasons can be
 * audited and replaced with real ones in follow-up commits.
 *
 * Idempotent — running the codemod twice on the same tree is a no-op
 * on already-annotated sites (the lint walker confirms the
 * annotation, and the codemod skips it).
 *
 * Audit-manifest 4-column format (one row per insertion):
 *   | file path | line number | current placeholder | suggested investigation steps |
 *
 * Usage:
 *   pnpm exec tsx tools/codemod-skip-annotations.ts [--apply] [rootDir]
 *
 * Without `--apply`, the codemod runs in DRY-RUN mode: it reports
 * what it WOULD change without touching the filesystem. The audit
 * manifest is also written in dry-run mode (so the test can verify
 * its shape without applying).
 *
 * Exit codes:
 *   0 — codemod ran successfully (any number of insertions)
 *   1 — codemod failed to write a file (rare)
 *   2 — internal error
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { exit } from "node:process";

import { runLint } from "./lint-skip-annotations.js";

/** The placeholder string the codemod injects. Audit log rows
 *  reference this verbatim. */
export const PLACEHOLDER_BODY = "pre-260527-pj6 — original reason unknown, audit required";

/** Composed annotation line (without trailing newline). */
export const PLACEHOLDER_LINE = `// SKIP-REASON: ${PLACEHOLDER_BODY}`;

/** Suggested investigation-steps column boilerplate, kept verbatim
 *  in the manifest format. */
const INVESTIGATION_STEPS = [
  "(a) `git blame` the `.skip(` line to find the original PR",
  "(b) read PR description for skip rationale",
  "(c) classify per SKIP-REASON taxonomy (requires-docker / topology-gated / setup-complete / deferred-fix)",
  "(d) replace placeholder with the real reason",
].join("; ");

export interface CodemodInsertion {
  /** Repository-relative POSIX path of the touched file. */
  file: string;
  /** 1-based line number where the placeholder will be inserted. */
  line: number;
  /** Callee text — `it.skip`, `describe.todo`, `xit`, etc. */
  callee: string;
}

export interface CodemodResult {
  insertions: CodemodInsertion[];
  applied: boolean;
}

/**
 * Compute the indentation prefix to mirror on the inserted comment
 * line. Reads the call-site source line and captures the run of
 * leading whitespace (spaces or tabs). Returns the empty string if
 * the line is missing (defensive).
 */
function indentOf(sourceLine: string | undefined): string {
  if (sourceLine === undefined) return "";
  const m = sourceLine.match(/^[ \t]*/);
  return m ? m[0] : "";
}

interface InsertOptions {
  /** Repository root. Insertions write back files using
   *  `<root>/<file>` paths. */
  root: string;
  /** When false, the filesystem is not touched (dry-run). */
  apply: boolean;
}

/**
 * Apply the placeholder insertions to disk (or simulate them).
 * Multiple insertions per file are applied bottom-up so the
 * earlier line numbers remain valid after each splice.
 *
 * Exported for unit testing.
 */
export function applyInsertions(insertions: CodemodInsertion[], opts: InsertOptions): void {
  if (insertions.length === 0) return;
  // Group by file.
  const byFile = new Map<string, CodemodInsertion[]>();
  for (const ins of insertions) {
    const arr = byFile.get(ins.file) ?? [];
    arr.push(ins);
    byFile.set(ins.file, arr);
  }
  for (const [file, group] of byFile) {
    // Sort descending by line so each splice doesn't shift its
    // siblings.
    group.sort((a, b) => b.line - a.line);
    const absPath = resolve(opts.root, file);
    const text = readFileSync(absPath, "utf8");
    const lines = text.split("\n");
    for (const ins of group) {
      // ins.line is 1-based; insertion index in the array is
      // (ins.line - 1). The placeholder is inserted ABOVE the
      // call, so splice at (ins.line - 1).
      const idx = ins.line - 1;
      const indent = indentOf(lines[idx]);
      lines.splice(idx, 0, `${indent}${PLACEHOLDER_LINE}`);
    }
    if (opts.apply) {
      writeFileSync(absPath, lines.join("\n"), "utf8");
    }
  }
}

/**
 * Compose the 4-column audit-manifest markdown body from the
 * insertion list. Exported for unit testing.
 */
export function composeAuditManifest(insertions: CodemodInsertion[]): string {
  const header = [
    "# SKIP-REASON audit backlog (Quick 260527-pj6 codemod)",
    "",
    "Generated by `tools/codemod-skip-annotations.ts`. Each row is a tracked TODO:",
    "the codemod inserted a placeholder `// SKIP-REASON: " + PLACEHOLDER_BODY + "` line",
    "above the call site to satisfy the lint gate at landing time. Follow-up Quick",
    "phases replace each placeholder with the real reason and drop the row.",
    "",
    "| file path | line number | current placeholder | suggested investigation steps |",
    "|---|---|---|---|",
  ].join("\n");
  const rows = insertions
    .slice()
    .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))
    .map((ins) => `| ${ins.file} | ${ins.line} | ${PLACEHOLDER_BODY} | ${INVESTIGATION_STEPS} |`)
    .join("\n");
  return `${header}\n${rows}\n`;
}

/** Default audit-manifest path relative to repo root. */
export const AUDIT_MANIFEST_REL_PATH =
  ".planning/quick/260527-pj6-pre-push-test-evidence-gate/SKIP-AUDIT-BACKLOG.md";

interface RunCodemodDeps {
  /** Repository root. */
  root: string;
  /** When false, the codemod is dry-run (filesystem untouched). */
  apply: boolean;
  /** Where to write the audit manifest. Override for tests. */
  manifestPath?: string;
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
}

/**
 * Pure-I/O entry point. Returns 0 on success, 1 on filesystem
 * failure, 2 on internal error.
 */
export function runCodemod(deps: RunCodemodDeps): number {
  try {
    const violations = runLint(deps.root);
    // Only "missing" (no annotation at all) is migrated. "too-short"
    // sites already have a SKIP-REASON line that the author wrote
    // explicitly — we don't silently replace their reason with the
    // placeholder.
    const insertions: CodemodInsertion[] = violations
      .filter((v) => v.reason === "missing")
      .map((v) => ({ file: v.file, line: v.line, callee: v.callee }));
    if (insertions.length === 0) {
      deps.stdout.write(`codemod-skip-annotations: no unannotated sites under ${deps.root}.\n`);
      return 0;
    }
    applyInsertions(insertions, { root: deps.root, apply: deps.apply });
    const manifestPath = deps.manifestPath ?? resolve(deps.root, AUDIT_MANIFEST_REL_PATH);
    const manifestBody = composeAuditManifest(insertions);
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, manifestBody, "utf8");
    deps.stdout.write(
      `codemod-skip-annotations: ${insertions.length} placeholder insertion(s); ` +
        `manifest at ${relative(deps.root, manifestPath).split(sep).join("/")} ` +
        `(apply=${deps.apply}).\n`,
    );
    return 0;
  } catch (err) {
    deps.stderr.write(
      `codemod-skip-annotations: internal error: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return 2;
  }
}

/* c8 ignore start — process-coupled CLI wiring, exercised by the
 * `pnpm exec tsx tools/codemod-skip-annotations.ts --apply` smoke. */
export function resolveRoot(): string {
  // Last positional argv that doesn't start with `--` is treated as the
  // root override; otherwise CWD.
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  return positional[0] ?? process.cwd();
}

export function mainEntry(): number {
  const apply = process.argv.includes("--apply");
  return runCodemod({
    root: resolveRoot(),
    apply,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}

const _argvUrl = (() => {
  try {
    return new URL(`file://${process.argv[1] ?? ""}`).href;
  } catch {
    return "";
  }
})();
const _isMain = import.meta.url === _argvUrl;

if (_isMain) {
  exit(mainEntry());
}
/* c8 ignore stop */

void join; // keep node:path imports used; relative/resolve used above.
