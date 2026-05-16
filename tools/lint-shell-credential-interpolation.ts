#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-shell-credential-interpolation.ts — Phase 31 / Plan 06 (LOCKER-06).
 *
 * Refuses shell command-string template literals that interpolate
 * credential-suffixed identifiers / env-reads. Specifically:
 *
 *   spawn("bash", ["-c", `pg_dump "${DATABASE_URL}"`])     ← FLAG
 *   execSync(`curl -H "Authorization: Bearer ${API_KEY}"`) ← FLAG
 *   exec(`echo ${MY_SECRET}`)                              ← FLAG
 *   execFileSync(`echo ${TOKEN}`)                          ← FLAG
 *   { cmd: "bash", args: ["-c", `... ${dbUrl} ...`] }      ← FLAG
 *
 * NOT flagged (false-positive guards):
 *
 *   /^Bearer\s+(.+)$/i.exec(value)            ← regex .exec method
 *   spawn("pg_dump", ["--dbname", DATABASE_URL]) ← argv-array (safe)
 *   execSync("echo hi")                         ← string literal, no interp
 *   execSync(`echo ${partition}`)               ← non-credential binding
 *
 * Detection: TypeScript Compiler API (mirrors tools/lint-tenant-context.ts).
 * Why AST not regex: the false-positive guard against the regex-method
 * `.exec(...)` is structural (PropertyAccessExpression callee vs bare
 * Identifier callee). AST distinguishes them without lookbehind acrobatics.
 *
 * Allowlist: `tools/lint-shell-credential-interpolation.allowlist.txt`
 * holds `file:line` entries (one per line). Lines beginning with `#` and
 * blank lines are skipped. Allowlisted findings are still reported (as
 * WARN) but do not flip the exit code to 1.
 *
 * --warn-only flag: all findings are reported but exit is forced to 0.
 * Used during initial landing (Phase 31) and during the WARN→BLOCKING
 * transition. Phase 36.a flips it to BLOCKING by removing --warn-only
 * from package.json + lefthook + ci.yml + Makefile in the SAME commit
 * that rewrites the audit-archive call sites.
 *
 * Exit codes:
 *   0 — no failing violations (clean OR --warn-only OR all-allowlisted)
 *   1 — failing violations present
 *   2 — internal error
 *
 * Usage:
 *   pnpm exec tsx tools/lint-shell-credential-interpolation.ts [--warn-only] [rootDir]
 */
import { existsSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { exit } from "node:process";
import ts from "typescript";

/**
 * Names of `child_process` callees that take a shell command string.
 * AST callee MUST be a plain Identifier (or one of these names imported as
 * a binding) — that excludes `re.exec(value)` (PropertyAccessExpression).
 */
const SHELL_CALLEES = new Set(["spawn", "exec", "execSync", "execFileSync"]);

/**
 * Suffix regex applied to interpolated identifier names. Credential-y
 * names ending in any of these flag the call. Matches at the END of an
 * identifier (case-insensitive) so e.g. `DATABASE_URL`, `MY_SECRET`,
 * `apiKey`, `accessToken`, `dbPassword` all hit. Underscored
 * UPPER_SNAKE is the canonical env-var shape; camelCase also covered.
 */
const CREDENTIAL_SUFFIX =
  /(?:_URL|_KEY|_PASSWORD|_SECRET|_TOKEN|[a-z](?:Url|Key|Password|Secret|Token))$/;

/**
 * Relative path of the optional allowlist file (from rootDir). One
 * `file:line` per non-blank, non-`#`-prefixed line.
 */
export const ALLOWLIST_FILE = "tools/lint-shell-credential-interpolation.allowlist.txt";

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
  // test scans them with scanFile() directly. They MUST be excluded from
  // the full-tree walk so `pnpm lint:shell-credential-interpolation` on
  // the real repo does not flag them.
  "tools/lint-shell-credential-interpolation/fixtures/**",
  // Type declaration files cannot host runtime expressions; skip for speed.
  "**/*.d.ts",
];

export interface Violation {
  /** POSIX path of the offending file, relative to scan rootDir. */
  file: string;
  /** 1-based line number of the offending template literal. */
  lineNumber: number;
  /** Label classifying the rule (single label for this linter). */
  label: string;
  /** Remediation hint surfaced to stderr. */
  remediation: string;
  /** Name of the interpolated credential-suffix binding (for debug). */
  binding: string;
}

interface FindingsBundle {
  /** Violations NOT covered by the allowlist — these fail the build. */
  violations: Violation[];
  /** Violations covered by the allowlist — reported as WARN only. */
  allowlisted: Violation[];
}

const REMEDIATION =
  "use argv-array form: spawn(cmd, [arg1, arg2, ...], { shell: false }) " +
  "— NEVER interpolate credentials into a bash -c shell string";

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
    /* c8 ignore next — split() always yields at least one element; `?? ""` is defensive. */
    const stripped = raw.split("#")[0] ?? "";
    const line = stripped.trim();
    if (!line) continue;
    out.add(line);
  }
  return out;
}

/**
 * Decide whether a TemplateExpression interpolates at least one
 * credential-suffixed binding. Returns the matched binding name, or null.
 *
 * Supports:
 *   `${IDENTIFIER}`              → matches if Identifier.text ends in suffix
 *   `${process.env.NAME}`        → matches if `.NAME` ends in suffix
 *   `${obj.someKey}`             → matches if `.someKey` ends in suffix
 *
 * Anything else (call expressions, complex member chains beyond depth 2,
 * etc.) is conservatively NOT matched — the violator set is small and
 * the false-positive-avoidance bias is documented in the plan.
 */
function templateInterpolatesCredential(node: ts.TemplateExpression): string | null {
  for (const span of node.templateSpans) {
    const expr = span.expression;
    let name: string | null = null;

    if (ts.isIdentifier(expr)) {
      name = expr.text;
    } else if (ts.isPropertyAccessExpression(expr)) {
      // process.env.DB_PASSWORD → use the trailing property name.
      name = expr.name.text;
    }

    if (name !== null && CREDENTIAL_SUFFIX.test(name)) {
      return name;
    }
  }
  return null;
}

/**
 * Returns true if `node` is a CallExpression to one of the bare-identifier
 * `child_process` shell-callees (spawn / exec / execSync / execFileSync).
 * A PropertyAccessExpression callee (`re.exec(...)`) returns false — that
 * is the regex-method false-positive guard.
 */
function isShellChildProcessCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isIdentifier(callee)) return false;
  return SHELL_CALLEES.has(callee.text);
}

/**
 * Returns true if `node` is an ArrayLiteralExpression whose first element
 * is the string literal "-c" (i.e. the `args: ["-c", <script>]` shape).
 * Lets the linter catch the audit-archive pattern where buildExportPlan
 * returns the array literal and the spawn happens elsewhere.
 */
function isBashDashCArrayLiteral(node: ts.Node): node is ts.ArrayLiteralExpression {
  if (!ts.isArrayLiteralExpression(node)) return false;
  /* c8 ignore next — defensive: ["-c", script] always has >= 2 elements in flagged shapes. */
  if (node.elements.length < 2) return false;
  const first = node.elements[0];
  /* c8 ignore next — defensive: array literal with >= 2 elements always has index 0. */
  if (!first || !ts.isStringLiteralLike(first)) return false;
  return first.text === "-c";
}

/**
 * Walk a TS SourceFile, find every credential-interpolating template
 * literal that lives inside a shell-execution context. Returns a Violation
 * per match (line number = template literal start line).
 *
 * "Shell-execution context" — the source file contains at least one
 *   (a) CallExpression whose callee is a bare child_process identifier
 *       (spawn / exec / execSync / execFileSync), OR
 *   (b) ArrayLiteralExpression whose first element is the string "-c"
 *       (the bash -c shell-arg shape).
 *
 * When EITHER context is present, the linter widens its scope to all
 * credential-interpolating template literals in the file. The widening is
 * necessary because the audit-archive.ts pattern (Phase 36.a's CR-5
 * source) builds a script string in a `const script = [\`...${cred}...\`,
 * ...].join(' | ')` outside the args literal; the var is then passed by
 * reference to `args: ['-c', script]`. The interpolation site is the
 * forensically interesting line, NOT the variable name in the args array.
 */
function visitForViolations(src: ts.SourceFile, filePosix: string, out: Violation[]): void {
  // First pass: does this source contain ANY shell-execution context?
  // If not, all template literals are safe regardless of their bindings
  // (no shell will see the interpolated value). This pass eliminates the
  // dominant false-positive class — credential-named locals used in HTTP
  // headers, log lines, etc.
  let hasShellContext = false;
  function detectContext(node: ts.Node): void {
    if (hasShellContext) return;
    if (isShellChildProcessCall(node) || isBashDashCArrayLiteral(node)) {
      hasShellContext = true;
      return;
    }
    ts.forEachChild(node, detectContext);
  }
  detectContext(src);
  if (!hasShellContext) return;

  // Second pass: flag every credential-interpolating template literal in
  // the file.
  function walk(node: ts.Node): void {
    if (ts.isTemplateExpression(node)) {
      const binding = templateInterpolatesCredential(node);
      if (binding !== null) {
        const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
        out.push({
          file: filePosix,
          lineNumber: line + 1,
          label: "shell-credential-interpolation",
          remediation: REMEDIATION,
          binding,
        });
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(src);
}

/**
 * Scan a single file and return all violations. Each violation is a
 * template-literal site (line-numbered against the source). Returns []
 * gracefully when the file does not exist or fails to parse.
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
  // Dedupe by file+line+binding (one logical site = one violation).
  const seen = new Set<string>();
  return out.filter((v) => {
    const key = `${v.file}:${v.lineNumber}:${v.binding}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Walk `rootDir`, scanFile every *.ts / *.tsx / *.mts / *.cts file (with
 * the IGNORE list applied), and split the resulting violations into two
 * buckets based on the allowlist: failing + allowlisted (WARN-only).
 */
export function findViolations(rootDir: string): FindingsBundle {
  const realRoot = resolve(rootDir);
  const allowlist = readAllowlist(realRoot);
  const violations: Violation[] = [];
  const allowlisted: Violation[] = [];

  // Synchronous walk: globSync would be ideal but the project's lint
  // helpers use the async glob from node:fs/promises. We collect file
  // paths sync via a helper to keep this function sync-friendly for the
  // unit test (which exercises runMain without await).
  // Implementation: defer to the sync helper below.
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
  /* c8 ignore next 3 — sort comparator: deterministic test runs only
     exercise the same-file branch, the cross-file + lt/gt direction
     branches are structurally unreachable from the fixture set. */
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.lineNumber - b.lineNumber;
}

/**
 * Synchronous file walker. Returns absolute paths matching SCAN_PATTERNS
 * minus IGNORE. Implemented manually (rather than via the async glob
 * helper) so runMain can stay synchronous.
 */
function walkFilesSync(realRoot: string): string[] {
  // `globSync` is exported by node:fs in recent Node versions; we use the
  // sync alternative from node:fs to keep runMain non-async. Falling back
  // to a manual readdir walk is robust to Node version skew.
  const { globSync } = require("node:fs") as {
    globSync?: (pattern: string, opts: { cwd: string; exclude?: string[] }) => string[];
  };

  const out: string[] = [];
  const seen = new Set<string>();

  if (typeof globSync === "function") {
    for (const pattern of SCAN_PATTERNS) {
      for (const f of globSync(pattern, { cwd: realRoot, exclude: IGNORE })) {
        /* c8 ignore next — dedup across SCAN_PATTERNS rarely fires in fixture trees. */
        if (seen.has(f)) continue;
        seen.add(f);
        out.push(resolve(realRoot, f));
      }
    }
    return out;
  }

  /* c8 ignore start — fallback for Node versions without globSync. */
  const { readdirSync, statSync } = require("node:fs") as {
    readdirSync: (p: string, opts?: { withFileTypes?: boolean }) => ts.Dirent[] | string[];
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
      entries = readdirSync(dir) as string[];
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
 * Async equivalent of findViolations — kept for parity with sibling
 * linters that consume the async glob iterator. Not currently used by
 * runMain (which is sync) but exported in case CI wiring needs it.
 *
 * c8 ignore start — covered indirectly via findViolations; this async
 * variant is for future ecosystem use.
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
 * rootDir. Returns the exit code (0 / 1 / 2) and writes diagnostics to the
 * injected sinks. The thin `mainEntry()` wrapper at the bottom of the file
 * feeds in real process streams; tests inject buffers.
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
      `lint-shell-credential-interpolation: internal error: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return 2;
  }

  const totalFailing = bundle.violations.length;
  const totalAllowlisted = bundle.allowlisted.length;

  if (totalFailing === 0 && totalAllowlisted === 0) {
    deps.stdout.write(`lint-shell-credential-interpolation: clean (${rootDir})\n`);
    return 0;
  }

  if (totalAllowlisted > 0) {
    deps.stderr.write(
      `lint-shell-credential-interpolation: ${totalAllowlisted} allowlisted finding(s) (WARN, non-blocking):\n`,
    );
    for (const v of bundle.allowlisted) {
      deps.stderr.write(`  WARN  ${v.file}:${v.lineNumber}  [${v.binding}]\n`);
    }
  }

  if (totalFailing === 0) {
    // Pure-allowlist case: visible debt but no fail. Still print a friendly
    // summary on stdout so CI logs show the linter ran.
    deps.stdout.write(
      `lint-shell-credential-interpolation: ${totalAllowlisted} allowlisted (no new violations)\n`,
    );
    return 0;
  }

  deps.stderr.write(
    `lint-shell-credential-interpolation: ${totalFailing} shell-credential-interpolation finding(s):\n`,
  );
  for (const v of bundle.violations) {
    const prefix = warnOnly ? "WARN" : "FAIL";
    deps.stderr.write(`  ${prefix}  ${v.file}:${v.lineNumber}  [${v.binding}]  ${v.remediation}\n`);
  }

  if (warnOnly) {
    deps.stderr.write(
      "(--warn-only) exiting 0 despite findings. Phase 36.a will flip to BLOCKING.\n",
    );
    return 0;
  }
  return 1;
}

/* c8 ignore start — entrypoint detection + process binding is exercised
   indirectly via the CLI subprocess smoke tests; coverage of this branch
   does not flow back through v8 instrumentation. */
const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return (
    arg1.endsWith("lint-shell-credential-interpolation.ts") ||
    arg1.endsWith("lint-shell-credential-interpolation.js")
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
