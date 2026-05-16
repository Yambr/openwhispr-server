#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-secret-shape-in-error.ts — Phase 31 / Plan 05 (LOCKER-05).
 *
 * Refuses an Error-derived class that exposes one of the dangerous field
 * names — `bodyText | responseBody | upstreamPayload | response | body` —
 * with type `string` (or `string | undefined`) UNLESS the constructor
 * truncates the field assignment via `.slice(...)` / `.substring(...)` /
 * `.substr(...)` / `truncate(...)`.
 *
 * Why this matters (STRIDE-Info-Disclosure, threat V7):
 *   pino's default serializer walks own properties of Error instances and
 *   ships them to Loki. A `public readonly bodyText: string` field whose
 *   value is the raw upstream payload exfiltrates secret-shaped responses
 *   into log storage. The CR-9 source at
 *   `packages/litellm-client/src/errors.ts:31` is the canonical violation
 *   addressed by Phase 37 (CRIT-FIX-09).
 *
 * Detection (TypeScript Compiler API, mirrors tools/lint-tenant-context.ts):
 *   1. Walk every ClassDeclaration in the file.
 *   2. If the direct heritage clause names an Identifier whose text ends
 *      in `Error` (matches `Error`, `BaseError`, `LitellmUpstreamError`,
 *      etc. — one-level walk, indirect chains are explicitly out of scope
 *      per 31-05-PLAN risk table), continue.
 *   3. For every PropertyDeclaration on that class:
 *        - skip if `private` modifier present (TS `private` is
 *          compile-time only at runtime, but pino's serializer treats
 *          underscore-private and TS-private the same; we accept the
 *          weaker invariant here because Phase 37's actual fix overrides
 *          `toJSON()`).
 *        - skip if the declared name is NOT one of the dangerous five.
 *        - skip if the declared type is NOT `string` and NOT
 *          `string | undefined` (cheap structural check on the type node).
 *        - check the class's constructor body for a statement of the
 *          shape `this.<field> = <truncating-expr>`. If absent → flag.
 *
 * --warn-only: all findings reported but exit forced to 0. Used during
 *   initial landing (Phase 31) and during the WARN→BLOCKING transition.
 *   Phase 37's closing commit drops `--warn-only` from package.json +
 *   lefthook + ci.yml + nightly.yml + Makefile in the SAME commit that
 *   rewrites `packages/litellm-client/src/errors.ts:31,40` to truncate
 *   the field and make it `private readonly` with a custom `toJSON()`.
 *
 * Allowlist: `tools/lint-secret-shape-in-error.allowlist.txt` holds
 *   `file:line` entries (one per line). Lines beginning with `#` and
 *   blank lines are skipped. Allowlisted findings are still reported (as
 *   WARN) but do not flip the exit code to 1.
 *
 * Exit codes:
 *   0 — no failing violations (clean OR --warn-only OR all-allowlisted)
 *   1 — failing violations present
 *   2 — internal error
 *
 * Usage:
 *   pnpm exec tsx tools/lint-secret-shape-in-error.ts [--warn-only] [rootDir]
 */
import { existsSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { exit } from "node:process";
import ts from "typescript";

/**
 * Dangerous field names. A class extending *Error with one of these as a
 * publicly-visible string field must truncate it in the constructor.
 */
const DANGEROUS_FIELDS = new Set([
  "bodyText",
  "responseBody",
  "upstreamPayload",
  "response",
  "body",
]);

/**
 * Method names that count as "truncating" the field assignment. Direct
 * dotted method calls on the RHS expression (`b.slice(0, N)`) or a
 * top-level helper call (`truncate(b, N)`) both satisfy the rule.
 */
const TRUNCATING_METHODS = new Set(["slice", "substring", "substr"]);
const TRUNCATING_HELPERS = new Set(["truncate"]);

export const ALLOWLIST_FILE = "tools/lint-secret-shape-in-error.allowlist.txt";

const SCAN_PATTERNS = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

const IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.stryker-tmp/**",
  "**/reports/**",
  "**/build/**",
  "**/.next/**",
  "**/__generated__/**",
  "**/.git/**",
  // Self-fixtures intentionally contain the violating pattern; the unit
  // test scans them via scanFile() directly. They MUST be excluded from
  // the full-tree walk so `pnpm lint:secret-shape-in-error` against the
  // real repo does not flag them.
  "tools/lint-secret-shape-in-error/fixtures/**",
  // Type declaration files cannot host runtime constructors.
  "**/*.d.ts",
];

export interface Violation {
  /** POSIX path of the offending file, relative to scan rootDir. */
  file: string;
  /** 1-based line number of the offending PropertyDeclaration. */
  lineNumber: number;
  /** Single rule label. */
  label: string;
  /** Remediation hint surfaced to stderr. */
  remediation: string;
  /** Name of the dangerous field that triggered the finding. */
  field: string;
  /** Name of the offending class (best-effort, for the debug line). */
  className: string;
}

interface FindingsBundle {
  /** Violations NOT covered by the allowlist — these fail the build. */
  violations: Violation[];
  /** Violations covered by the allowlist — reported as WARN only. */
  allowlisted: Violation[];
}

const REMEDIATION =
  "truncate the field at construction (`this.field = body.slice(0, 200)`) " +
  "and prefer `private readonly` + custom `toJSON()` for defence-in-depth " +
  "(see Phase 37 / CRIT-FIX-09 for the canonical fix)";

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Read the allowlist file at `rootDir/ALLOWLIST_FILE`. Returns the set of
 * `file:line` entries. Blank lines and `#`-prefixed lines are skipped;
 * trailing `# comment` on a value line is stripped.
 */
export function readAllowlist(rootDir: string): Set<string> {
  const file = join(rootDir, ALLOWLIST_FILE);
  if (!existsSync(file)) return new Set();
  const out = new Set<string>();
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    /* c8 ignore next — defensive against empty split() result. */
    const stripped = raw.split("#")[0] ?? "";
    const line = stripped.trim();
    if (!line) continue;
    out.add(line);
  }
  return out;
}

/**
 * Returns true iff the class declaration's direct heritage clause names
 * an Identifier whose text ends in `Error`. Matches `Error`, `BaseError`,
 * `LitellmUpstreamError`, etc. The 31-05 plan documents that indirect
 * heritage chains (>1 level) are out of scope.
 */
function classExtendsError(cls: ts.ClassDeclaration): boolean {
  const clauses = cls.heritageClauses;
  if (!clauses) return false;
  for (const clause of clauses) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const t of clause.types) {
      const expr = t.expression;
      if (ts.isIdentifier(expr) && /Error$/.test(expr.text)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns true iff `modifiers` includes the `private` keyword.
 */
function isPrivateField(modifiers: readonly ts.ModifierLike[] | undefined): boolean {
  if (!modifiers) return false;
  return modifiers.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword);
}

/**
 * Returns true iff the property's declared type is structurally
 * `string` or `string | undefined`. We don't load the typechecker; this
 * is a cheap syntactic match against the TypeNode.
 */
function isStringTyped(typeNode: ts.TypeNode | undefined): boolean {
  if (!typeNode) return false;
  if (typeNode.kind === ts.SyntaxKind.StringKeyword) return true;
  if (ts.isUnionTypeNode(typeNode)) {
    let sawString = false;
    let sawUndefined = false;
    for (const t of typeNode.types) {
      if (t.kind === ts.SyntaxKind.StringKeyword) sawString = true;
      else if (t.kind === ts.SyntaxKind.UndefinedKeyword) sawUndefined = true;
      /* c8 ignore next — other union members beyond {string, undefined}
         cause the cheap match to fall through; the locker conservatively
         declines to flag in that case. */ else return false;
    }
    return sawString && sawUndefined;
  }
  return false;
}

/**
 * Returns true iff `expr` is a "truncating expression" — i.e. one of:
 *   * `x.slice(...)` / `x.substring(...)` / `x.substr(...)`  (method on
 *     a string-typed LHS — we don't check the LHS type)
 *   * `truncate(...)`                                          (bare-id helper)
 *
 * The fast structural match keeps the locker hermetic (no typechecker).
 * Helper-based truncation through arbitrary names is intentionally NOT
 * accepted — the plan's risk table directs those rare cases through the
 * allowlist with a `# helper-truncated-in-<helperName>` rationale.
 */
function isTruncatingExpression(expr: ts.Expression): boolean {
  if (!ts.isCallExpression(expr)) return false;
  const callee = expr.expression;
  if (ts.isIdentifier(callee) && TRUNCATING_HELPERS.has(callee.text)) {
    return true;
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.name) &&
    TRUNCATING_METHODS.has(callee.name.text)
  ) {
    return true;
  }
  return false;
}

/**
 * Returns true iff the constructor body contains a top-level statement
 * of the shape `this.<field> = <truncating-expr>`. Walks the constructor
 * body recursively to handle conditional / block-nested assignments.
 */
function ctorTruncatesField(ctor: ts.ConstructorDeclaration, field: string): boolean {
  const body = ctor.body;
  if (!body) return false;
  let truncated = false;
  function visit(node: ts.Node): void {
    if (truncated) return;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const lhs = node.left;
      if (
        ts.isPropertyAccessExpression(lhs) &&
        lhs.expression.kind === ts.SyntaxKind.ThisKeyword &&
        ts.isIdentifier(lhs.name) &&
        lhs.name.text === field &&
        isTruncatingExpression(node.right)
      ) {
        truncated = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(body);
  return truncated;
}

/**
 * Find the (first) ConstructorDeclaration on a class. Returns null if
 * the class has no explicit constructor (which is itself a finding-eligible
 * shape, since the field can never be truncated then).
 */
function findConstructor(cls: ts.ClassDeclaration): ts.ConstructorDeclaration | null {
  for (const m of cls.members) {
    if (ts.isConstructorDeclaration(m)) return m;
  }
  return null;
}

/**
 * Visit a SourceFile and append violations for any *Error-derived class
 * with a publicly-visible dangerous string field that the constructor
 * does not truncate.
 */
function visitForViolations(src: ts.SourceFile, filePosix: string, out: Violation[]): void {
  function walk(node: ts.Node): void {
    if (ts.isClassDeclaration(node) && classExtendsError(node)) {
      const ctor = findConstructor(node);
      const className = node.name?.text ?? "<anonymous>";
      for (const member of node.members) {
        if (!ts.isPropertyDeclaration(member)) continue;
        if (!ts.isIdentifier(member.name)) continue;
        const fieldName = member.name.text;
        if (!DANGEROUS_FIELDS.has(fieldName)) continue;
        if (isPrivateField(member.modifiers)) continue;
        if (!isStringTyped(member.type)) continue;
        if (ctor !== null && ctorTruncatesField(ctor, fieldName)) continue;
        const { line } = src.getLineAndCharacterOfPosition(member.getStart(src));
        out.push({
          file: filePosix,
          lineNumber: line + 1,
          label: "LOCKER-05-LEAK",
          remediation: REMEDIATION,
          field: fieldName,
          className,
        });
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(src);
}

/**
 * Scan a single file and return all violations. Returns [] gracefully
 * when the file does not exist or fails to parse.
 */
export function scanFile(file: string): Violation[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const out: Violation[] = [];
  visitForViolations(src, toPosix(file), out);
  return out;
}

/**
 * Synchronous file walker. Returns absolute paths matching SCAN_PATTERNS
 * minus IGNORE. Mirrors the lint-shell-credential-interpolation walker.
 */
function walkFilesSync(realRoot: string): string[] {
  const { globSync } = require("node:fs") as {
    globSync?: (pattern: string, opts: { cwd: string; exclude?: string[] }) => string[];
  };
  const out: string[] = [];
  const seen = new Set<string>();
  if (typeof globSync === "function") {
    for (const pattern of SCAN_PATTERNS) {
      for (const f of globSync(pattern, { cwd: realRoot, exclude: IGNORE })) {
        /* c8 ignore next — dedup rarely fires under fixture trees. */
        if (seen.has(f)) continue;
        seen.add(f);
        out.push(resolve(realRoot, f));
      }
    }
    return out;
  }
  /* c8 ignore start — fallback for Node versions without globSync. */
  const { readdirSync, statSync } = require("node:fs") as {
    readdirSync: (p: string) => string[];
    statSync: (p: string) => { isDirectory: () => boolean };
  };
  const stack: string[] = [realRoot];
  const IGNORE_SEGMENTS = new Set([
    "node_modules",
    "dist",
    "coverage",
    ".stryker-tmp",
    "reports",
    "build",
    ".next",
    "__generated__",
    ".git",
  ]);
  while (stack.length > 0) {
    const dir = stack.pop() ?? "";
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (IGNORE_SEGMENTS.has(name)) continue;
      const full = join(dir, name);
      try {
        if (statSync(full).isDirectory()) {
          stack.push(full);
        } else if (/\.(ts|tsx|mts|cts)$/.test(name) && !name.endsWith(".d.ts")) {
          out.push(full);
        }
      } catch {}
    }
  }
  return out;
  /* c8 ignore stop */
}

/**
 * Walk `rootDir`, scanFile every *.ts / *.tsx / *.mts / *.cts file (with
 * IGNORE applied), and bucket the violations against the allowlist.
 */
export function findViolations(rootDir: string): FindingsBundle {
  const realRoot = resolve(rootDir);
  const allowlist = readAllowlist(realRoot);
  const violations: Violation[] = [];
  const allowlisted: Violation[] = [];

  for (const file of walkFilesSync(realRoot)) {
    const findings = scanFile(file);
    if (findings.length === 0) continue;
    const relPosix = toPosix(relative(realRoot, file));
    for (const v of findings) {
      const keyed: Violation = { ...v, file: relPosix };
      const allowKey = `${relPosix}:${v.lineNumber}`;
      if (allowlist.has(allowKey)) {
        allowlisted.push(keyed);
      } else {
        violations.push(keyed);
      }
    }
  }

  violations.sort(compareViolation);
  allowlisted.sort(compareViolation);
  return { violations, allowlisted };
}

function compareViolation(a: Violation, b: Violation): number {
  /* c8 ignore next 3 — cross-file branch + lt/gt direction are
     structurally unreachable from the fixture set. */
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.lineNumber - b.lineNumber;
}

/**
 * Async equivalent of findViolations — exported for ecosystem parity but
 * not used by runMain (which stays sync for test ergonomics).
 *
 * c8 ignore start — exercised indirectly via findViolations.
 */
/* c8 ignore start */
export async function findViolationsAsync(rootDir: string): Promise<FindingsBundle> {
  const realRoot = resolve(rootDir);
  const allowlist = readAllowlist(realRoot);
  const violations: Violation[] = [];
  const allowlisted: Violation[] = [];
  const seen = new Set<string>();
  for (const pattern of SCAN_PATTERNS) {
    for await (const f of glob(pattern, { cwd: realRoot, exclude: IGNORE })) {
      const rel = typeof f === "string" ? f : String(f);
      if (seen.has(rel)) continue;
      seen.add(rel);
      const full = resolve(realRoot, rel);
      const findings = scanFile(full);
      for (const v of findings) {
        const keyed: Violation = { ...v, file: toPosix(rel) };
        const allowKey = `${keyed.file}:${v.lineNumber}`;
        if (allowlist.has(allowKey)) allowlisted.push(keyed);
        else violations.push(keyed);
      }
    }
  }
  violations.sort(compareViolation);
  allowlisted.sort(compareViolation);
  return { violations, allowlisted };
}
/* c8 ignore stop */

interface RunMainDeps {
  argv: string[];
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
}

/**
 * Pure-I/O entry point. Parses argv for --warn-only flag and a positional
 * rootDir. Returns the exit code (0 / 1 / 2) and writes diagnostics to
 * the injected sinks. Tests inject buffers; the script entry below feeds
 * real process streams.
 */
export function runMain(deps: RunMainDeps): number {
  let warnOnly = false;
  const positional: string[] = [];
  for (const arg of deps.argv) {
    if (arg === "--warn-only") warnOnly = true;
    else positional.push(arg);
  }
  const rootDir = positional[0] ?? process.cwd();

  let bundle: FindingsBundle;
  try {
    bundle = findViolations(rootDir);
  } catch (err) {
    deps.stderr.write(
      `lint-secret-shape-in-error: internal error: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return 2;
  }

  const totalFailing = bundle.violations.length;
  const totalAllowlisted = bundle.allowlisted.length;

  if (totalFailing === 0 && totalAllowlisted === 0) {
    deps.stdout.write(`lint-secret-shape-in-error: clean (${rootDir})\n`);
    return 0;
  }

  if (totalAllowlisted > 0) {
    deps.stderr.write(
      `lint-secret-shape-in-error: ${totalAllowlisted} allowlisted finding(s) (WARN, non-blocking):\n`,
    );
    for (const v of bundle.allowlisted) {
      deps.stderr.write(`  WARN  ${v.file}:${v.lineNumber}  [${v.className}.${v.field}]\n`);
    }
  }

  if (totalFailing === 0) {
    deps.stdout.write(
      `lint-secret-shape-in-error: ${totalAllowlisted} allowlisted (no new violations)\n`,
    );
    return 0;
  }

  deps.stderr.write(
    `lint-secret-shape-in-error: ${totalFailing} secret-shape-in-error finding(s):\n`,
  );
  for (const v of bundle.violations) {
    const prefix = warnOnly ? "WARN" : "FAIL";
    deps.stderr.write(
      `  ${prefix}  ${v.file}:${v.lineNumber}  [${v.className}.${v.field}]  ${v.remediation}\n`,
    );
  }

  if (warnOnly) {
    deps.stderr.write(
      "(--warn-only) exiting 0 despite findings. Phase 37 will flip to BLOCKING.\n",
    );
    return 0;
  }
  return 1;
}

/* c8 ignore start — entrypoint detection + process binding is exercised
   indirectly via the CLI subprocess smoke tests; v8 instrumentation does
   not surface coverage for the boot branch. */
const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return (
    arg1.endsWith("lint-secret-shape-in-error.ts") || arg1.endsWith("lint-secret-shape-in-error.js")
  );
})();

if (invokedDirect) {
  const code = runMain({
    argv: process.argv.slice(2),
    stdout: process.stdout,
    stderr: process.stderr,
  });
  exit(code);
}
/* c8 ignore stop */
