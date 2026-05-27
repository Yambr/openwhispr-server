#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-vitest-reporter-inheritance.ts — Quick 260527-pj6.
 *
 * Defence-in-depth linter that walks every `vitest.config.ts` in the
 * repository and refuses any workspace whose `reporters:` array does
 * NOT include the evidence reporter
 * (`tools/test-evidence-reporter.ts`).
 *
 * Inheritance contract — three accepted shapes for `reporters:`:
 *
 *   1. **Absent** — the workspace omits `reporters:` entirely → it
 *      inherits from the root config (which DOES carry the evidence
 *      reporter). ACCEPTED.
 *   2. **Explicit array containing the evidence reporter path** —
 *      e.g. `reporters: ["dot", "./tools/test-evidence-reporter.ts"]`
 *      or `reporters: ["dot", resolve(ROOT_DIR, "tools/test-evidence-
 *      reporter.ts")]` (resolved-path form acceptable when the
 *      string literal segment `tools/test-evidence-reporter.ts`
 *      appears anywhere inside the array element's source range).
 *      ACCEPTED.
 *   3. **Anything else** — string-form (`reporters: "default"`),
 *      spread form (`reporters: [...someVar, ...]`), or computed-
 *      variable form (`reporters: someExternalList`). REFUSED.
 *
 * Root config edge case: the root `vitest.config.ts` is itself
 * subject to rule (2) — it cannot inherit from anything. If the
 * root config omits `reporters:` entirely, the lint REFUSES it
 * (rule applied via `isRootConfig` branch).
 *
 * Multi-project root configs: each inline
 * `{ extends: true, test: { reporters: [...] } }` entry in the root
 * config's `projects` array is independently validated.
 *
 * Exit codes:
 *   0 — all configs pass (or no configs found, theoretical)
 *   1 — at least one violation
 *   2 — internal error (parser bomb, missing dir, etc.)
 *
 * Usage:
 *   pnpm lint:vitest-reporter-inheritance
 *   pnpm exec tsx tools/lint-vitest-reporter-inheritance.ts [rootDir]
 */
import { globSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { exit } from "node:process";
import { Node, Project, type SourceFile } from "ts-morph";

/** Substring of the canonical evidence-reporter module path. A
 *  workspace's `reporters:` entry passes if ANY string literal
 *  element in the array contains this substring anywhere in its
 *  source range (resolved-path / absolute-path forms still embed
 *  the literal `tools/test-evidence-reporter.ts` segment). */
export const EVIDENCE_REPORTER_PATH_NEEDLE = "tools/test-evidence-reporter.ts";

/** Globs of files this lint walks. Anchored at the caller-supplied
 *  root. The root config + per-workspace configs are both scanned. */
export const VITEST_CONFIG_GLOBS = [
  "vitest.config.ts",
  "apps/*/vitest.config.ts",
  "packages/*/vitest.config.ts",
  "tools/*/vitest.config.ts",
  "compose/*/vitest.config.ts",
  "tests/e2e/vitest.config.ts",
  "tests/e2e/*/vitest.config.ts",
];

/** Path-segment substrings disqualifying a candidate config (e.g.
 *  `node_modules`, worktree mirrors). */
const IGNORE_SEGMENTS = ["node_modules", "dist", ".next", ".stryker-tmp", ".claude/worktrees"];

export type ViolationReason =
  | "string-form"
  | "spread-or-computed"
  | "missing-evidence-reporter"
  | "root-config-omits-reporters";

export interface ReporterViolation {
  file: string;
  line: number;
  reason: ViolationReason;
  /** Optional context — e.g. the project name when the violation
   *  is in an inline `defineProject` block. */
  context?: string;
}

/** Detects whether the file is the repo-root `vitest.config.ts`
 *  (path === `vitest.config.ts` after relative normalisation). */
function isRootConfig(relPath: string): boolean {
  return relPath === "vitest.config.ts";
}

/**
 * Inspect the `reporters:` PropertyAssignment value node. Returns
 * `"ok"` when the contract is satisfied for THIS node, or a
 * `ViolationReason` otherwise. Caller decides what to do (root vs
 * child workspace, inline-project nesting).
 */
function classifyReportersValue(
  initialiser: Node,
): "ok" | "string-form" | "spread-or-computed" | "missing-evidence-reporter" {
  if (Node.isStringLiteral(initialiser)) {
    return "string-form";
  }
  if (!Node.isArrayLiteralExpression(initialiser)) {
    // Unknown shape (Identifier, CallExpression, etc.) — cannot
    // statically verify.
    return "spread-or-computed";
  }
  let sawSpread = false;
  let sawEvidence = false;
  for (const el of initialiser.getElements()) {
    if (Node.isSpreadElement(el)) {
      sawSpread = true;
      continue;
    }
    // Inspect element source text for the canonical needle.
    const elText = el.getText();
    if (elText.includes(EVIDENCE_REPORTER_PATH_NEEDLE)) {
      sawEvidence = true;
    }
  }
  if (sawSpread) return "spread-or-computed";
  if (!sawEvidence) return "missing-evidence-reporter";
  return "ok";
}

/**
 * Walks a `vitest.config.ts` file. Returns one ReporterViolation per
 * `reporters:` property assignment that fails the inheritance
 * contract, OR a single `root-config-omits-reporters` violation if
 * the root config has zero `reporters:` assignments anywhere.
 */
export function scanFile(absPath: string, relPath: string): ReporterViolation[] {
  let source: string;
  try {
    source = readFileSync(absPath, "utf8");
  } catch {
    return [];
  }
  const project = new Project({ useInMemoryFileSystem: false });
  const src: SourceFile = project.createSourceFile(absPath, source, { overwrite: true });
  const out: ReporterViolation[] = [];
  let reportersAssignmentSeen = false;

  src.forEachDescendant((node) => {
    if (!Node.isPropertyAssignment(node)) return;
    const nameNode = node.getNameNode();
    if (!Node.isIdentifier(nameNode) || nameNode.getText() !== "reporters") return;

    // Require the `reporters:` assignment to live under a `test:`
    // ancestor PropertyAssignment so we don't false-positive on
    // `coverage: { reporter: ... }` (singular, different key) or
    // unrelated config keys named "reporters" elsewhere in the
    // workspace tree.
    let ancestor: Node | undefined = node.getParent();
    let underTest = false;
    while (ancestor) {
      if (Node.isPropertyAssignment(ancestor)) {
        const aName = ancestor.getNameNode();
        if (Node.isIdentifier(aName) && aName.getText() === "test") {
          underTest = true;
          break;
        }
      }
      ancestor = ancestor.getParent();
    }
    if (!underTest) return;

    reportersAssignmentSeen = true;
    const initialiser = node.getInitializer();
    if (!initialiser) return;
    const result = classifyReportersValue(initialiser);
    if (result === "ok") return;
    const lineNumber = node.getStartLineNumber();
    out.push({
      file: relPath,
      line: lineNumber,
      reason: result,
    });
  });

  // Root config special case: if no `reporters:` was found anywhere
  // (no inline projects declared one either), the root cannot
  // inherit. REFUSED.
  if (isRootConfig(relPath) && !reportersAssignmentSeen) {
    out.push({
      file: relPath,
      line: 1,
      reason: "root-config-omits-reporters",
    });
  }
  return out;
}

function ignoreFile(relPath: string): boolean {
  const posix = relPath.split(sep).join("/");
  for (const seg of IGNORE_SEGMENTS) {
    if (posix.includes(`/${seg}/`) || posix.startsWith(`${seg}/`)) return true;
  }
  return false;
}

/**
 * Walks every `vitest.config.ts` under `root` and returns the set
 * of inheritance-contract violations.
 */
export function runLint(root: string): ReporterViolation[] {
  const seen = new Set<string>();
  const out: ReporterViolation[] = [];
  for (const pattern of VITEST_CONFIG_GLOBS) {
    const matches = globSync(join(root, pattern));
    for (const absPath of matches) {
      const rel = relative(root, absPath).split(sep).join("/");
      if (seen.has(rel)) continue;
      seen.add(rel);
      if (ignoreFile(rel)) continue;
      for (const v of scanFile(absPath, rel)) out.push(v);
    }
  }
  out.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return out;
}

interface RunMainDeps {
  root: string;
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
}

export function runMain(deps: RunMainDeps): number {
  let violations: ReporterViolation[];
  try {
    violations = runLint(deps.root);
  } catch (err) {
    deps.stderr.write(
      `lint-vitest-reporter-inheritance: internal error: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return 2;
  }
  if (violations.length === 0) {
    deps.stdout.write(`lint-vitest-reporter-inheritance PASSED (root=${deps.root}).\n`);
    return 0;
  }
  deps.stderr.write(
    `lint-vitest-reporter-inheritance FAILED: ${violations.length} workspace(s) ` +
      `do not inherit/include the evidence reporter:\n`,
  );
  for (const v of violations) {
    const detail =
      v.reason === "string-form"
        ? "string-form reporters cannot include evidence reporter, refactor to explicit array"
        : v.reason === "spread-or-computed"
          ? "cannot statically verify reporters[] contains evidence reporter, refactor to explicit string array"
          : v.reason === "root-config-omits-reporters"
            ? "root vitest.config.ts cannot inherit reporters; explicit array required"
            : `reporters[] does not include ${EVIDENCE_REPORTER_PATH_NEEDLE}`;
    deps.stderr.write(`  ${v.file}:${v.line} — ${detail}\n`);
  }
  deps.stderr.write(
    "remediation: see docs/test-evidence-gate.md §11.6 (workspace reporter inheritance contract).\n",
  );
  return 1;
}

/* c8 ignore start — process-coupled CLI wiring. */
export function resolveRoot(): string {
  return process.env.LINT_VITEST_REPORTER_INHERITANCE_ROOT ?? process.cwd();
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

// Keep node:path resolve in scope (its imported value is referenced
// indirectly when ts-morph computes file URLs).
void resolve;
