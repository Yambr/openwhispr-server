#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-skip-annotations.ts — Quick 260527-pj6.
 *
 * Enforces a `// SKIP-REASON: <text ≥ 10 chars>` annotation within 5 lines
 * ABOVE every `.skip` / `.todo` call site. The pre-push test-evidence
 * gate (`tools/lint-pre-push-test-evidence.ts`) REFUSES any commit whose
 * evidence fragments report `unannotated_skip > 0`; this lint catches
 * the same drift at static-scan time before the test run.
 *
 * Detected call shapes (TypeScript Compiler API, mirrors
 * `tools/lint-no-plaintext-secret-columns.ts`):
 *
 *   it.skip(...)
 *   test.skip(...)
 *   describe.skip(...)
 *   it.todo(...)
 *   test.todo(...)
 *   describe.todo(...)
 *   xit(...)
 *   xdescribe(...)
 *
 * The AST walker matches CallExpression nodes whose callee is either:
 *   - a PropertyAccessExpression whose object identifier is one of
 *     {it, test, describe} AND whose property identifier is one of
 *     {skip, todo}; OR
 *   - a bare Identifier with text matching one of {xit, xdescribe}.
 *
 * The walker does NOT match `// describe.skip from beforeAll` inside a
 * line-comment because TypeScript's parser strips comments before the
 * walk (gotcha #8 from RESEARCH R4.3).
 *
 * Annotation contract: within the 5 source lines IMMEDIATELY ABOVE
 * the call, AT LEAST ONE line (after trimming leading whitespace) must
 * match `/^\/\/\s*SKIP-REASON:\s+(.{10,})$/`. Line N (call) and lines
 * N-1..N-5 are scanned (a 5-line lookback window).
 *
 * Scope globs (executed via Node's `fs.globSync`):
 *   apps/​**​/*.{ts,tsx}
 *   packages/​**​/*.{ts,tsx}
 *   tests/e2e-cjm/​**​/*.{ts,tsx}
 *   tests/integration/​**​/*.ts
 *
 * Exclusions: node_modules, dist, .next, .stryker-tmp, .claude/worktrees,
 * the tool's own source + test (self-exempt).
 *
 * Exit codes:
 *   0 — no violations
 *   1 — at least one violation
 *   2 — internal error (parser bomb, missing dir, etc.)
 *
 * Usage:
 *   pnpm lint:skip-annotations
 *   pnpm exec tsx tools/lint-skip-annotations.ts [rootDir]
 */
import { globSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { exit } from "node:process";
import ts from "typescript";

/** The `.skip` / `.todo` property names matched on a
 *  PropertyAccessExpression callee. */
const SKIP_MODE_PROPS = new Set(["skip", "todo"]);

/** The {it, test, describe} object identifiers matched on a
 *  PropertyAccessExpression callee. */
const SKIP_HOSTS = new Set(["it", "test", "describe"]);

/** Bare-identifier callees treated identically to `.skip`. */
const X_BARE_CALLEES = new Set(["xit", "xdescribe"]);

/** Regex that matches a valid SKIP-REASON annotation line (after
 *  trimming leading whitespace). Captures the reason body so the
 *  ≥10-char rule can be enforced. */
const SKIP_REASON_RE = /^\/\/\s*SKIP-REASON:\s+(.+)$/;

/** Source-line lookback window above each `.skip` / `.todo` call. */
const SKIP_LOOKBACK_LINES = 5;

/** Minimum reason length (chars after the colon-space, trimmed). */
const SKIP_MIN_REASON_LEN = 10;

export interface SkipViolation {
  /** Repository-relative POSIX path of the file. */
  file: string;
  /** 1-based line number of the offending call expression. */
  line: number;
  /** Human-readable callee text — e.g. `describe.skip`, `xit`. */
  callee: string;
  /** Reason classification — `"missing"` (no annotation) or
   *  `"too-short"` (annotation present but body < 10 chars). */
  reason: "missing" | "too-short";
}

/**
 * Walk a SourceFile and append a SkipViolation for every matching call
 * expression whose 5-line lookback window lacks a SKIP-REASON.
 *
 * Exported for direct unit-test calls.
 */
export function visitForSkips(src: ts.SourceFile, filePath: string, out: SkipViolation[]): void {
  const lines = src.getFullText().split("\n");
  function walk(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let calleeText: string | undefined;
      if (ts.isPropertyAccessExpression(callee)) {
        const obj = callee.expression;
        const prop = callee.name;
        if (ts.isIdentifier(obj) && SKIP_HOSTS.has(obj.text) && SKIP_MODE_PROPS.has(prop.text)) {
          calleeText = `${obj.text}.${prop.text}`;
        }
      } else if (ts.isIdentifier(callee) && X_BARE_CALLEES.has(callee.text)) {
        calleeText = callee.text;
      }
      if (calleeText !== undefined) {
        const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
        // line is 0-based here; convert to 1-based for reporting.
        const oneBasedLine = line + 1;
        const reason = checkAnnotation(lines, line);
        if (reason !== "ok") {
          out.push({ file: filePath, line: oneBasedLine, callee: calleeText, reason });
        }
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(src);
}

/**
 * Inspect the 5 source lines immediately above the call line
 * (`callLine` is 0-based — the `getLineAndCharacterOfPosition`
 * return value). Returns:
 *   "ok"         — at least one line in the window matches the
 *                   annotation regex AND the captured body's trimmed
 *                   length is ≥ 10 chars
 *   "missing"    — no line in the window matches the annotation regex
 *   "too-short"  — at least one line matches the regex, but EVERY
 *                   matching line's body is < 10 chars
 */
export function checkAnnotation(lines: string[], callLine: number): "ok" | "missing" | "too-short" {
  const start = Math.max(0, callLine - SKIP_LOOKBACK_LINES);
  let sawMatch = false;
  for (let i = start; i < callLine; i++) {
    const trimmed = (lines[i] ?? "").trim();
    const m = trimmed.match(SKIP_REASON_RE);
    if (!m) continue;
    sawMatch = true;
    const body = (m[1] ?? "").trim();
    if (body.length >= SKIP_MIN_REASON_LEN) return "ok";
  }
  return sawMatch ? "too-short" : "missing";
}

/**
 * Scan a single file. Returns [] on read / parse error (matches the
 * pattern in `lint-no-plaintext-secret-columns.ts`).
 */
export function scanFile(file: string): SkipViolation[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const out: SkipViolation[] = [];
  visitForSkips(src, file, out);
  return out;
}

/** Glob patterns scanned by the lint. Each entry is anchored at the
 *  caller-supplied root. */
const SCAN_PATTERNS = [
  "apps/**/*.ts",
  "apps/**/*.tsx",
  "packages/**/*.ts",
  "packages/**/*.tsx",
  "tests/e2e-cjm/**/*.ts",
  "tests/e2e-cjm/**/*.tsx",
  "tests/integration/**/*.ts",
];

/** Path-segment substrings that disqualify a candidate file. */
const IGNORE_SEGMENTS = [
  "node_modules",
  "dist",
  ".next",
  ".stryker-tmp",
  ".claude/worktrees",
  "coverage",
];

/** Self-exempt files (this tool + its sibling test). The walker would
 *  otherwise match strings inside the test fixtures. */
const SELF_EXEMPT = new Set([
  "tools/lint-skip-annotations.ts",
  "tools/__tests__/lint-skip-annotations.test.ts",
]);

function ignoreFile(relPath: string): boolean {
  const posix = relPath.split(sep).join("/");
  if (SELF_EXEMPT.has(posix)) return true;
  for (const seg of IGNORE_SEGMENTS) {
    if (posix.includes(`/${seg}/`) || posix.startsWith(`${seg}/`)) return true;
  }
  return false;
}

/**
 * Run the lint across all matching files under `root`. Exported so
 * tests can run it against a synthetic fixture root.
 */
export function runLint(root: string): SkipViolation[] {
  const seen = new Set<string>();
  const out: SkipViolation[] = [];
  for (const pattern of SCAN_PATTERNS) {
    const matches = globSync(join(root, pattern));
    for (const absPath of matches) {
      const rel = relative(root, absPath).split(sep).join("/");
      if (seen.has(rel)) continue;
      seen.add(rel);
      if (ignoreFile(rel)) continue;
      for (const v of scanFile(absPath)) {
        out.push({ ...v, file: rel });
      }
    }
  }
  // Sort for deterministic output (test stability).
  out.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return out;
}

interface RunMainDeps {
  root: string;
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
}

/**
 * Pure-I/O entry point — returns 0 / 1 / 2 per the exit-code contract.
 */
export function runMain(deps: RunMainDeps): number {
  let violations: SkipViolation[];
  try {
    violations = runLint(deps.root);
  } catch (err) {
    deps.stderr.write(
      `lint-skip-annotations: internal error: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return 2;
  }

  if (violations.length === 0) {
    deps.stdout.write(`lint-skip-annotations PASSED (root=${deps.root}).\n`);
    return 0;
  }

  deps.stderr.write(
    `lint-skip-annotations FAILED: ${violations.length} unannotated skip/todo site(s):\n`,
  );
  for (const v of violations) {
    const detail =
      v.reason === "missing"
        ? `missing // SKIP-REASON: <≥${SKIP_MIN_REASON_LEN} chars> within ${SKIP_LOOKBACK_LINES} lines above`
        : `// SKIP-REASON: body too short (<${SKIP_MIN_REASON_LEN} chars)`;
    deps.stderr.write(`  ${v.file}:${v.line} — ${v.callee} ${detail}\n`);
  }
  deps.stderr.write(
    "remediation: insert `// SKIP-REASON: <≥10 chars>` on a line within the 5-line lookback window above each call.\n",
  );
  return 1;
}

/* c8 ignore start — process-coupled CLI wiring; exercised via the
 * `pnpm lint:skip-annotations` smoke, mirroring the c8-ignore band in
 * tools/lint-no-plaintext-secret-columns.ts. */
export function resolveRoot(): string {
  return process.env.LINT_SKIP_ANNOTATIONS_ROOT ?? process.cwd();
}

export function mainEntry(): number {
  return runMain({ root: resolveRoot(), stdout: process.stdout, stderr: process.stderr });
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

// Re-export the constants for tests that want to verify the canonical
// values without restating them.
export { IGNORE_SEGMENTS, SCAN_PATTERNS, SELF_EXEMPT, SKIP_LOOKBACK_LINES, SKIP_MIN_REASON_LEN };

/**
 * Internal helper exposed for the resolve() import in this file —
 * avoids a "unused import" lint when `resolve` would otherwise be
 * elided in some build paths. The runLint() caller passes already-
 * resolved absolute roots.
 */
void resolve;
