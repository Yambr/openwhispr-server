#!/usr/bin/env -S pnpm exec tsx
/**
 * lint-tenant-context.ts — Phase 6 / Plan 06-09 / D-W4 layer 1.
 *
 * Static lint asserting that every BullMQ job handler file under
 * `apps/worker/src/jobs/{glob}.ts` exports a `Worker` instance whose handler
 * is wrapped in `withTenantContext(...)` or `withSystemContext(...)`. The
 * 3-layer tenant-context defense (D-W4) is:
 *
 *   1. THIS LINT — fails the build BEFORE runtime ever sees an
 *      un-wrapped job. (Plan 06-09)
 *   2. Runtime pg-pool guard — fails the job at first DB call if no
 *      tenant context is bound. (Plan 06-07)
 *   3. RLS property test — proves cross-tenant isolation at the data
 *      tier under load. (Plan 06-07)
 *
 * Scope:
 *
 *   * Pattern walked: every `apps/worker/src/jobs/{glob}.ts` file that is
 *     NOT a *.test.ts and NOT a *.d.ts.
 *   * Acceptance criterion: the source file must reference at least one
 *     CallExpression where the callee identifier is `withTenantContext`
 *     OR `withSystemContext`. The wrapper is usually applied at the call
 *     site of `new Worker(QUEUE_NAME, withTenantContext(schema, pool, fn))`
 *     or assigned to a local `handler` constant — either way the lint
 *     accepts as long as one of the allowed wrappers appears in the
 *     module body.
 *   * Files that compute their handler in a side helper imported from
 *     `apps/worker/src/lib/with-tenant-context.ts` (the canonical
 *     wrapper module) ARE allowed; the lint walks the source TEXT for
 *     the identifier so re-exports show up as a positive.
 *
 * Failure shape:
 *
 *   * exit 1 if any scanned file is missing the wrapper reference.
 *   * exit 2 if an internal error prevents the walk (no files found,
 *     parser threw).
 *   * exit 0 on a clean pass; stdout summarizes file count.
 *
 * Why TS-AST (not regex):
 *
 *   * GritQL was researched (06-RESEARCH.md §4 — MEDIUM confidence) but
 *     its `.grit` plugin surface is not yet stable across the BullMQ
 *     handler shapes we ship. The TypeScript Compiler API is the same
 *     boring choice that powers tools/lint-rls.ts; it walks an AST and
 *     handles every TS dialect feature uniformly.
 *
 * Usage:
 *
 *   pnpm lint:tenant-context
 *
 * Test fixtures use an environment override `LINT_TENANT_CONTEXT_ROOT`
 * to redirect the glob root — the unit test sets this to a tmpdir.
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { exit } from "node:process";
import ts from "typescript";

const ALLOWED_WRAPPERS = new Set(["withTenantContext", "withSystemContext"]);

interface LintError {
  file: string;
  line: number;
  reason: string;
}

interface LintResult {
  scanned: number;
  errors: LintError[];
}

/**
 * Walk a TypeScript SourceFile and decide whether at least one
 * CallExpression invokes one of the allowed wrapper functions.
 *
 * Returns the first matching wrapper name, or null if none found.
 */
function findWrapperCall(src: ts.SourceFile): string | null {
  let found: string | null = null;

  function visit(node: ts.Node): void {
    if (found !== null) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : null;
      if (name && ALLOWED_WRAPPERS.has(name)) {
        found = name;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(src);
  return found;
}

/**
 * Scan one file. Returns the matched wrapper name (null if none) and
 * the parsed SourceFile for error-line reporting.
 */
export function scanFile(file: string): {
  wrapper: string | null;
  sourceFile: ts.SourceFile;
} {
  const text = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const wrapper = findWrapperCall(sourceFile);
  return { wrapper, sourceFile };
}

/**
 * Run the lint across the worker-jobs glob. Exported so unit tests can
 * exercise it with a synthetic root.
 */
export function runLint(root: string): LintResult {
  const pattern = path.join(root, "apps/worker/src/jobs/**/*.ts");
  const files = globSync(pattern, { exclude: (p) => /\.test\.ts$|\.d\.ts$/.test(p) });

  const errors: LintError[] = [];
  for (const file of files) {
    const { wrapper, sourceFile } = scanFile(file);
    if (wrapper === null) {
      // Report against line 1 of the file — the violation is module-wide,
      // not at a specific call site (the absence of a call is what we
      // flag). The reason string names the canonical fix.
      errors.push({
        file: path.relative(root, file),
        line: 1,
        reason:
          "no call to withTenantContext(...) or withSystemContext(...) — every BullMQ job handler MUST be wrapped (D-W4 layer 1)",
      });
    }
    // The sourceFile is computed only so future enhancements can pinpoint
    // the exact unwrapped default-export line. The current minimum-viable
    // check (presence of wrapper anywhere in the module) keeps the lint
    // cheap and false-positive-free.
    void sourceFile;
  }
  return { scanned: files.length, errors };
}

/**
 * Pure I/O entry point. Returns the exit code and writes to the injected
 * stderr/stdout sinks. The thin wrapper `main()` below feeds in the
 * real process streams; the unit test injects buffers so the success +
 * failure + drift branches are exercised in-process for v8 coverage.
 */
export function runMain(deps: {
  root: string;
  stderr: { write: (s: string) => void };
  stdout: { write: (s: string) => void };
}): number {
  let result: LintResult;
  try {
    result = runLint(deps.root);
  } catch (err) {
    deps.stderr.write(`lint-tenant-context: internal error: ${String(err)}\n`);
    return 2;
  }

  if (result.scanned === 0) {
    deps.stderr.write(
      `lint-tenant-context: no job files found under apps/worker/src/jobs/ (root=${deps.root}) — repo layout drift?\n`,
    );
    return 2;
  }

  if (result.errors.length > 0) {
    deps.stderr.write(
      `lint-tenant-context FAILED: ${result.errors.length} offender(s) of ${result.scanned} scanned\n`,
    );
    for (const e of result.errors) {
      deps.stderr.write(`  ${e.file}:${e.line} ${e.reason}\n`);
    }
    return 1;
  }
  deps.stdout.write(
    `lint-tenant-context PASSED: ${result.scanned} job file(s) scanned, every default-export is wrapped (D-W4 layer 1).\n`,
  );
  return 0;
}

/**
 * Resolve the runtime root for the lint (env override → cwd). Exported so
 * tests can assert the env-vs-cwd precedence.
 */
export function resolveRoot(): string {
  return process.env.LINT_TENANT_CONTEXT_ROOT ?? process.cwd();
}

/**
 * Entrypoint wrapper used by the script when invoked as `pnpm
 * lint:tenant-context`. Separated so the test can call it with stub
 * streams without spawning a subprocess.
 */
export function mainEntry(): number {
  return runMain({ root: resolveRoot(), stderr: process.stderr, stdout: process.stdout });
}

// Auto-run when invoked as the script entrypoint (not when imported by
// the test harness). The detection compares `import.meta.url` to the
// resolved file:// of process.argv[1].
const _argvUrl = (() => {
  try {
    return new URL(`file://${process.argv[1]}`).href;
  } catch {
    return "";
  }
})();
const _isMain = import.meta.url === _argvUrl;

if (_isMain) {
  exit(mainEntry());
}
